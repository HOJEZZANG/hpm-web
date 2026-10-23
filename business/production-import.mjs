// Version 2 production staging uses existing import/row tables. No legacy row is replaced.
import {ensure,BusinessError,text} from './domain.mjs';
import {admin,idOk,now} from './access.mjs';
import {limitedBytes} from './http.mjs';
import {MIME,inspectZip} from './excel.mjs';
import {productionLimits as L,byteLength} from './production-limits.mjs';
import {validateMetadata,normalizeProductionRow} from './production-sheet.mjs';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
async function json(req,max){ensure(req.headers.get('content-type')?.includes('application/json'),'JSON 요청이 필요합니다.');try{return JSON.parse(new TextDecoder().decode(await limitedBytes(req,max)));}catch(e){if(e.status)throw e;throw new BusinessError(400,'JSON 형식을 확인하세요.');}}
export async function beginProduction(req,env,u){
  admin(u);const b=await json(req,L.metadata+4096);ensure(b&&idOk(b.id)&&/^[a-f0-9]{64}$/.test(b.sha256)&&Number.isInteger(b.size)&&b.size>22&&b.size<=L.file,'파일 ID/크기/해시를 확인하세요.');
  const filename=text(b.filename,'파일명',200,true);ensure(/\.xlsx$/i.test(filename),'지원 형식은 .xlsx입니다.');validateMetadata(b.meta);
  const old=await env.DB.prepare('SELECT * FROM plan_imports WHERE id=?').bind(b.id).first();
  if(old){ensure(old.kind==='production'&&old.owner===u.id&&old.sha256===b.sha256&&JSON.parse(old.staged_data).version===2,'업로드 ID가 다른 자료에 사용됐습니다.',409);const prior=JSON.parse(old.staged_data);ensure(JSON.stringify(prior.columns)===JSON.stringify(b.meta.columns)&&JSON.stringify(prior.mapping)===JSON.stringify(b.meta.mapping)&&old.row_count===b.meta.rowCount,'재시도 열 선택/원본이 다릅니다. 새 미리보기를 시작하세요.',409);return {id:old.id,retry:true};}
  ensure(!await env.DB.prepare("SELECT id FROM plan_imports WHERE kind='production' AND sha256=? AND status='applied'").bind(b.sha256).first(),'동일 파일이 이미 반영됐습니다. 이력에서 조회하세요.',409);
  const meta={...b.meta,version:2,phase:'source',size:b.size,sourceReady:false,stagedCount:0,stagedBytes:0,stagedCells:0};await env.DB.prepare('INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(b.id,'production',u.id,filename,'business/imports/'+b.id+'.xlsx',b.sha256,b.meta.rowCount,JSON.stringify(meta),now()).run();return {id:b.id};
}
export async function productionImport(req,env,u,r,action,url){
  const meta=JSON.parse(r.staged_data),count=async()=>Number((await env.DB.prepare('SELECT count(*) AS n FROM production_rows WHERE import_id=?').bind(r.id).first()).n);
  if(req.method==='GET'&&action==='rows'){
    ensure(r.status==='applied'||u.role==='admin','미반영 원본 행은 관리자만 조회할 수 있습니다.',403);const offset=Number(url.searchParams.get('offset')||0);ensure(Number.isSafeInteger(offset)&&offset>=0,'조회 위치를 확인하세요.');
    const source=(await env.DB.prepare('SELECT row_number,data FROM production_rows WHERE import_id=? ORDER BY row_number LIMIT 100 OFFSET ?').bind(r.id,offset).all()).results,records=[];let bytes=0;
    for(const row of source){if(records.length&&bytes+row.data.length>512*1024)break;const d=JSON.parse(row.data);records.push({number:row.row_number,values:d.__cells,formulas:d.__formulas||[]});bytes+=row.data.length;}
    const staged=await count();return {records,nextOffset:offset+records.length<staged?offset+records.length:null,total:staged};
  }
  if(req.method==='GET'){
    ensure(r.status==='applied'||u.role==='admin','미반영 미리보기는 관리자만 조회할 수 있습니다.',403);
    const staged=await count(),first=(await env.DB.prepare('SELECT row_number,data FROM production_rows WHERE import_id=? ORDER BY row_number LIMIT 20').bind(r.id).all()).results;
    return {id:r.id,status:r.status,version:2,sha256:r.sha256,filename:r.filename,meta,staged,applyCount:r.row_count,rows:first.map(x=>({number:x.row_number,data:JSON.parse(x.data)})),headers:meta.columns.map(c=>c.title),canApply:r.status==='preview'&&meta.sourceReady&&meta.phase==='ready'&&staged===r.row_count};
  }
  admin(u);
  if(req.method==='PUT'&&action==='file'){
    ensure(r.status!=='applied','이미 반영된 원본을 변경할 수 없습니다.',409);if(meta.sourceReady)return {id:r.id,sourceReady:true,retry:true};
    const bytes=await limitedBytes(req,L.file);ensure(bytes.length===meta.size&&await hash(bytes)===r.sha256,'원본 파일 크기/해시가 다릅니다. 같은 파일로 재시도하세요.',409);inspectZip(bytes,{file:L.file,expanded:L.expanded,directoryOnly:true});
    await env.PHOTOS.put(r.file_key,bytes,{httpMetadata:{contentType:MIME}});await env.DB.prepare("UPDATE plan_imports SET staged_data=json_set(staged_data,'$.sourceReady',json('true'),'$.phase','staging') WHERE id=? AND status='preview'").bind(r.id).run();return {id:r.id,sourceReady:true};
  }
  if(req.method==='POST'&&action==='chunk'){
    ensure(r.status==='preview'&&meta.sourceReady&&meta.phase==='staging','분할 전송 가능한 상태가 아닙니다.',409);const b=await json(req,L.chunk);ensure(b&&Array.isArray(b.rows)&&b.rows.length&&b.rows.length<=L.chunkRows,'한 번에 최대 20행/256KiB씩 전송하세요.');ensure(new Set(b.rows.map(r=>r.number)).size===b.rows.length,'분할 요청 내 행 번호가 중복됩니다.');
    const expected=b.rows.map(raw=>({number:raw.number,data:JSON.stringify(normalizeProductionRow(raw,meta))}));
    // Count only new rows within the same atomic batch. Do not rescan all prior
    // JSON for every chunk. Even 20-row chunks stay below 50 D1 statements/request.
    const statements=expected.flatMap(x=>[
      env.DB.prepare("UPDATE plan_imports SET staged_data=json_set(staged_data,'$.stagedCount',json_extract(staged_data,'$.stagedCount')+1,'$.stagedBytes',json_extract(staged_data,'$.stagedBytes')+?,'$.stagedCells',json_extract(staged_data,'$.stagedCells')+?) WHERE id=? AND NOT EXISTS(SELECT 1 FROM production_rows WHERE import_id=? AND row_number=?)").bind(byteLength(x.data),JSON.parse(x.data).__cellCount,r.id,r.id,x.number),
      env.DB.prepare('INSERT INTO production_rows(id,import_id,row_number,data) VALUES(?,?,?,?) ON CONFLICT(import_id,row_number) DO NOTHING').bind(r.id+'_'+x.number,r.id,x.number,x.data)
    ]);
    const guard=crypto.randomUUID();statements.push(env.DB.prepare("INSERT INTO business_write_guards(id,ok) SELECT ?,CASE WHEN json_extract(staged_data,'$.stagedCount')<=row_count AND json_extract(staged_data,'$.stagedBytes')<=? AND json_extract(staged_data,'$.stagedCells')<=? AND NOT EXISTS(SELECT 1 FROM json_each(?) incoming JOIN production_rows p ON p.import_id=plan_imports.id AND p.row_number=json_extract(incoming.value,'$.number') WHERE p.data<>json_extract(incoming.value,'$.data')) THEN 1 ELSE 0 END FROM plan_imports WHERE id=?").bind(guard,L.staged,L.cells,JSON.stringify(expected),r.id));statements.push(env.DB.prepare('DELETE FROM business_write_guards WHERE id=?').bind(guard));
    try{await env.DB.batch(statements);}catch(e){if(/CHECK|constraint/i.test(e.message)){const actual=(await env.DB.prepare('SELECT row_number,data FROM production_rows WHERE import_id=? AND row_number IN ('+expected.map(()=>'?').join(',')+')').bind(r.id,...expected.map(r=>r.number)).all()).results;ensure(!expected.some(x=>actual.some(a=>a.row_number===x.number&&a.data!==x.data)),'같은 행 번호에 다른 값이 있습니다. 이번 분할 요청 전체를 저장하지 않았습니다.',409);throw new BusinessError(413,'유효 셀 250,000개/해석 데이터 32MiB 처리 예산을 초과했습니다. 현재 요청은 반영되지 않았습니다.');}throw e;}
    const actual=(await env.DB.prepare('SELECT row_number,data FROM production_rows WHERE import_id=? AND row_number IN ('+expected.map(()=>'?').join(',')+')').bind(r.id,...expected.map(r=>r.number)).all()).results;
    ensure(expected.every(x=>actual.some(a=>a.row_number===x.number&&a.data===x.data)),'같은 행 번호에 다른 값이 있습니다. 기존 값을 덮어쓰지 않았습니다.',409);return {id:r.id,staged:await count(),total:r.row_count};
  }
  if(req.method==='POST'&&action==='ready'){
    ensure(r.status==='preview'&&meta.sourceReady&&await count()===r.row_count,'원본/전송 행이 모두 확인되지 않았습니다.',409);await env.DB.prepare("UPDATE plan_imports SET staged_data=json_set(staged_data,'$.phase','ready') WHERE id=? AND status='preview'").bind(r.id).run();return {id:r.id,ready:true,staged:r.row_count};
  }
  ensure(req.method==='POST'&&action==='apply','지원하지 않는 요청입니다.',405);
  if(r.status==='applied')return {id:r.id,applied:r.row_count,retry:true};ensure(meta.sourceReady&&meta.phase==='ready'&&await count()===r.row_count,'전송을 완료하고 미리보기를 확인한 뒤 반영하세요.',409);
  try{await env.DB.prepare("UPDATE plan_imports SET status='applied',applied_at=? WHERE id=? AND status='preview'").bind(now(),r.id).run();}catch(e){if(/UNIQUE/i.test(e.message))throw new BusinessError(409,'동일 파일이 이미 반영됐습니다. 이력을 확인하세요.');throw e;}return {id:r.id,applied:r.row_count};
}
