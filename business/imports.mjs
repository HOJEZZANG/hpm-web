import {BusinessError,ensure,text,date,productionSummary} from './domain.mjs';
import {parseWorkbook,template,createWorkbook,MIME} from './excel.mjs';
import {multipart,binary} from './http.mjs';
import {idOk,now,admin} from './access.mjs';
export async function imports(req,env,u,id,action,url){
  if(req.method==='GET'&&id==='template'){const kind=url.searchParams.get('kind');ensure(['production','supplies'].includes(kind),'양식 구분을 확인하세요.');return binary(await template(kind),kind+'_양식_예시포함.xlsx');}
  if(req.method==='GET'&&!id){
    const kind=url.searchParams.get('kind');ensure(['production','supplies'].includes(kind),'업로드 구분을 확인하세요.');
    return {records:(await env.DB.prepare('SELECT id,kind,filename,row_count,status,created_at,applied_at FROM plan_imports WHERE kind=? ORDER BY created_at DESC,id LIMIT 200').bind(kind).all()).results};
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
  if(req.method==='GET'&&action==='file'){const object=await env.PHOTOS.get(r.file_key);ensure(object,'원본 파일이 없습니다.',404);return binary(object.body,r.filename);}
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
  const id=url.searchParams.get('import');if(!id){ensure(url.searchParams.get('download')!=='1','반영 이력을 선택한 뒤 다운로드하세요.');return {records:[],summary:kind==='production'?productionSummary([]):undefined};}
  ensure(idOk(id),'업로드 이력을 선택하세요.');
  const table=kind==='production'?'production_rows':'supply_items';
  const rows=(await env.DB.prepare(`SELECT * FROM ${table} WHERE import_id=? ORDER BY row_number`).bind(id).all()).results.map(r=>({id:r.id,...JSON.parse(r.data)}));
  const eqColumn=['제조사양관리구분','분류','LINE 5000'].find(k=>rows.some(r=>Object.hasOwn(r,k))),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(from)date(from);if(to)date(to);ensure(!from||!to||from<=to,'PND 종료일은 시작일 이후여야 합니다.');
  const q=url.searchParams.get('q')?.trim().toLowerCase();const filtered=rows.filter(r=>(!q||Object.values(r).some(v=>String(v).toLowerCase().includes(q)))&&(!url.searchParams.get('equipment')||r[eqColumn]===url.searchParams.get('equipment'))&&['제조사양관리구분','Yard','현공정','작업장'].every(k=>!url.searchParams.get(k)||r[k]===url.searchParams.get(k))&&(!from||(r.PND&&r.PND>=from))&&(!to||(r.PND&&r.PND<=to)));
  if(url.searchParams.get('download')==='1')return binary(await createWorkbook([...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>k!=='id'),filtered),'조회결과.xlsx');
  return {records:filtered,...(kind==='production'?{summary:productionSummary(filtered)}:{})};
}
