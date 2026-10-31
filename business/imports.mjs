import {BusinessError,ensure,text,date,productionSummary,isProductionCompletionTitle,productionEquipment} from './domain.mjs';
import {parseWorkbook,template,createWorkbook,MIME,excelDate} from './excel.mjs';
import {multipart,binary} from './http.mjs';
import {idOk,now,admin} from './access.mjs';
import {beginProduction,productionImport} from './production-import.mjs';
import {productionWorkbook} from './production-export.mjs';
export async function latestProduction(env){return env.DB.prepare("SELECT id,filename,row_count,applied_at,created_at,sha256 FROM plan_imports WHERE kind='production' AND status='applied' ORDER BY applied_at DESC,created_at DESC,id DESC LIMIT 1").first();}
export async function imports(req,env,u,id,action,url){
  if(req.method==='GET'&&id==='latest'){ensure(url.searchParams.get('kind')==='production','업로드 구분을 확인하세요.');return {record:await latestProduction(env)};}
  if(req.method==='POST'&&id==='start')return beginProduction(req,env,u);
  if(req.method==='GET'&&id==='template'){const kind=url.searchParams.get('kind');ensure(['production','supplies'].includes(kind),'양식 구분을 확인하세요.');return binary(await template(kind),kind+'_양식_예시포함.xlsx');}
  if(req.method==='GET'&&!id){
    const kind=url.searchParams.get('kind');ensure(['production','supplies'].includes(kind),'업로드 구분을 확인하세요.');
    return {records:(await env.DB.prepare("SELECT id,kind,filename,row_count,status,created_at,applied_at,json_extract(staged_data,'$.version') AS version,json_extract(staged_data,'$.phase') AS phase FROM plan_imports WHERE kind=? ORDER BY created_at DESC,id LIMIT 200").bind(kind).all()).results};
  }
  if(req.method==='POST'&&!id){
    admin(u);const {form,file}=await multipart(req),kind=form.get('kind');ensure(['production','supplies'].includes(kind),'업로드 구분을 확인하세요.');ensure(/\.xlsx$/i.test(file.name),'지원 형식은 .xlsx입니다. .xls는 .xlsx로 저장하세요.');
    const bytes=new Uint8Array(await file.arrayBuffer()),parsed=await parseWorkbook(bytes,kind);
    ensure(new TextEncoder().encode(JSON.stringify(parsed)).length<=1024*1024,'해석된 데이터가 1MB를 초과합니다. 파일을 나누어 업로드하세요.',413);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    const duplicate=await env.DB.prepare("SELECT id FROM plan_imports WHERE sha256=? AND kind=? AND status='applied' LIMIT 1").bind(hash,kind).first();
    ensure(!duplicate,'이미 반영한 동일 파일입니다. 이력에서 조회하세요.',409);
    const newId=crypto.randomUUID(),key=`business/imports/${newId}.xlsx`,filename=text(file.name.replaceAll('\\','/').split('/').at(-1),'파일명',200,true);
    await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:MIME}});
    try{await env.DB.prepare('INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(newId,kind,u.id,filename,key,hash,parsed.rows.length,JSON.stringify(parsed),now()).run();}catch(e){await env.PHOTOS.delete(key);throw e;}
    return {id:newId,...parsed,applyCount:parsed.rows.length};
  }
  ensure(idOk(id),'업로드 ID를 확인하세요.');const r=await env.DB.prepare('SELECT * FROM plan_imports WHERE id=?').bind(id).first();ensure(r,'업로드 이력이 없습니다.',404);
  if(req.method==='GET'&&action==='file'){ensure(r.status==='applied'||u.role==='admin','미반영 원본은 관리자만 조회할 수 있습니다.',403);const object=await env.PHOTOS.get(r.file_key);ensure(object,'원본 파일이 없습니다.',404);return binary(object.body,r.filename);}
  if(JSON.parse(r.staged_data).version===2)return productionImport(req,env,u,r,action,url);
  if(req.method==='GET')return {id:r.id,status:r.status,...JSON.parse(r.staged_data),applyCount:r.row_count};
  ensure(req.method==='POST'&&action==='apply','지원하지 않는 요청입니다.',405);admin(u);
  if(r.status==='applied')return {applied:r.row_count,id:r.id,retry:true};
  const table=r.kind==='production'?'production_rows':'supply_items';
  const statements=JSON.parse(r.staged_data).rows.map(row=>env.DB.prepare(`INSERT INTO ${table}(id,import_id,row_number,data) VALUES(?,?,?,?) ON CONFLICT(import_id,row_number) DO NOTHING`).bind(`${r.id}_${row.number}`,r.id,row.number,JSON.stringify(row.data)));
  statements.push(env.DB.prepare("UPDATE plan_imports SET status='applied',applied_at=? WHERE id=? AND status='preview'").bind(now(),id));
  try{await env.DB.batch(statements);}catch(e){if(/UNIQUE.*plan_imports|applied_import_hash/i.test(e.message))throw new BusinessError(409,'동일 파일을 다른 요청이 이미 반영했습니다. 이력을 새로 조회하세요.');throw e;}
  return {applied:r.row_count,id:r.id};
}
export async function rowsApi(env,kind,url){
  let id=url.searchParams.get('import');const latest=!id&&kind==='production'?await latestProduction(env):null;if(latest)id=latest.id;
  if(!id){ensure(url.searchParams.get('download')!=='1','반영된 자료가 없습니다.');return {importId:null,imported:null,records:[],summary:kind==='production'?productionSummary([]):undefined};}
  ensure(idOk(id),'업로드 이력을 선택하세요.');
  const imported=await env.DB.prepare('SELECT id,filename,row_count,applied_at,created_at,status,kind,staged_data FROM plan_imports WHERE id=?').bind(id).first();ensure(imported&&imported.kind===kind,'업로드 이력이 없습니다.',404);ensure(imported.status==='applied','아직 반영되지 않은 전송/미리보기 자료입니다.',409);
  const meta=JSON.parse(imported.staged_data);
  if(kind==='production'&&meta.version===2){
    ensure(url.searchParams.get('download')!=='1','대용량 엑셀은 화면의 조회 결과 다운로드를 이용하세요.');
    const offset=Number(url.searchParams.get('offset')||0);ensure(Number.isSafeInteger(offset)&&offset>=0,'조회 위치를 확인하세요.');
    const completionColumns=meta.columns.filter(c=>isProductionCompletionTitle(c.title)),completion=meta.mapping?.['실제완료일']|| (completionColumns.length===1?completionColumns[0].id:null),index=meta.columns.findIndex(c=>c.id===completion);
    const completionFieldState=index>=0?'present':completionColumns.length>1?'ambiguous':'missing';
    const records=(await env.DB.prepare("SELECT id,row_number,json_remove(data,'$.__cells','$.__formulas','$.__cellCount') AS data"+(index>=0?",json_extract(data,'$.__cells["+index+"]') AS completion_raw":"")+" FROM production_rows WHERE import_id=? ORDER BY row_number LIMIT 200 OFFSET ?").bind(id,offset).all()).results.map(r=>{const data=JSON.parse(r.data);if(index>=0&&!Object.hasOwn(data,'실제완료일')){try{data['실제완료일']=excelDate(r.completion_raw??'','실제 완료일',meta.date1904);}catch{data['실제완료일']=String(r.completion_raw??'');}}return {id:r.id,...data};});
    ensure(records.length===Math.min(200,Math.max(0,meta.rowCount-offset)),'저장 자료 조회가 불완전합니다. 기존 자료를 유지하고 다시 조회하세요.',503);
    return {importId:id,imported:{id,filename:imported.filename,row_count:imported.row_count,applied_at:imported.applied_at},version:2,records,total:meta.rowCount,nextOffset:offset+records.length<meta.rowCount?offset+records.length:null,meta,completionFieldState};
  }
  const table=kind==='production'?'production_rows':'supply_items';
  const rows=(await env.DB.prepare(`SELECT * FROM ${table} WHERE import_id=? ORDER BY row_number`).bind(id).all()).results.map(r=>({id:r.id,...JSON.parse(r.data)}));
  const eqColumn=['제조사양관리구분','분류','LINE 5000'].find(k=>rows.some(r=>Object.hasOwn(r,k))),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(from)date(from);if(to)date(to);ensure(!from||!to||from<=to,'PND 종료일은 시작일 이후여야 합니다.');
  const q=url.searchParams.get('q')?.trim().toLowerCase();const filtered=rows.filter(r=>(!q||Object.values(r).some(v=>String(v).toLowerCase().includes(q)))&&(!url.searchParams.get('equipment')||productionEquipment(r,eqColumn)===url.searchParams.get('equipment'))&&['제조사양관리구분','Yard','현공정','작업장'].every(k=>!url.searchParams.get(k)||r[k]===url.searchParams.get(k))&&(!from||(r.PND&&r.PND>=from))&&(!to||(r.PND&&r.PND<=to)));
  if(url.searchParams.get('download')==='1'){const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>k!=='id');return binary(kind==='production'?productionWorkbook(columns,filtered):await createWorkbook(columns,filtered),'조회결과.xlsx');}
  return {importId:id,imported:{id,filename:imported.filename,row_count:imported.row_count,applied_at:imported.applied_at},records:filtered,...(kind==='production'?{summary:productionSummary(filtered)}:{})};
}
