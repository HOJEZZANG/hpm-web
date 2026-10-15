import {BusinessError,ensure,date,isoWeek,koreanToday,addDays} from './domain.mjs';
import {bodyJson,multipart} from './http.mjs';
import {idOk,now,admin} from './access.mjs';
export async function meals(req,env,u,url){
  const start=isoWeek(date(url.searchParams.get('week')||koreanToday())).monday;
  if(req.method==='GET'){
    const {results}=await env.DB.prepare('SELECT * FROM meals WHERE day>=? AND day<=? ORDER BY day,person_id').bind(start,addDays(start,6)).all();return {records:results};
  }
  ensure(req.method==='PUT','지원하지 않는 요청입니다.',405);const b=await bodyJson(req);
  ensure(Array.isArray(b.records)&&b.records.length>0&&b.records.length<=350,'1~350개 식수 항목을 저장할 수 있습니다.');
  const people=(await env.DB.prepare('SELECT id FROM meal_people').all()).results.map(r=>r.id),seen=new Set(),statements=[],guardId=crypto.randomUUID();
  statements.push(env.DB.prepare(`INSERT INTO business_write_guards(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN meals m ON m.person_id=json_extract(j.value,'$.person_id') AND m.day=json_extract(j.value,'$.day') WHERE COALESCE(m.revision,0)<>json_extract(j.value,'$.revision')) THEN 0 ELSE 1 END`).bind(guardId,JSON.stringify(b.records)));
  for(const r of b.records){
    ensure(r&&typeof r==='object'&&!Array.isArray(r),'식수 항목 형식을 확인하세요.');
    ensure(people.includes(r.person_id),'관리 인원을 먼저 등록하세요.');date(r.day);ensure(r.day>=start&&r.day<=addDays(start,6),'선택 주차의 날짜만 저장하세요.');
    const key=r.person_id+'/'+r.day;ensure(!seen.has(key),'인원/날짜가 중복되었습니다.');seen.add(key);
    ensure(['breakfast','lunch','dinner'].every(k=>r[k]===0||r[k]===1),'식사 여부는 0 또는 1이어야 합니다.');ensure(Number.isInteger(r.revision)&&r.revision>=0,'식수 버전을 확인하세요.');
    // A guard INSERT makes a stale update fail the entire D1 batch, including new rows.
    statements.push(env.DB.prepare(`INSERT INTO meals(person_id,day,breakfast,lunch,dinner,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(person_id,day) DO UPDATE SET breakfast=excluded.breakfast,lunch=excluded.lunch,dinner=excluded.dinner,revision=meals.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(r.person_id,r.day,r.breakfast,r.lunch,r.dinner,u.id,now()));
  }
  // Guards contain no business data and are removed inside the same transaction.
  statements.push(env.DB.prepare('DELETE FROM business_write_guards WHERE id=?').bind(guardId));
  try{await env.DB.batch(statements);}catch(e){if(/CHECK constraint failed.*ok|BUSINESS_STALE/i.test(e.message))throw new BusinessError(409,'다른 PC에서 식수 내역을 변경했습니다. 현재 입력을 보관하고 다시 조회하세요.');throw e;}
  return {saved:b.records.length};
}
export async function menu(req,env,u,id,url){
  const start=isoWeek(date(url.searchParams.get('week')||koreanToday())).monday;
  if(req.method==='GET'&&!id)return {records:(await env.DB.prepare('SELECT id,week_start,created_at FROM meal_menus WHERE week_start=? ORDER BY created_at DESC,id').bind(start).all()).results};
  if(req.method==='POST'&&!id){
    admin(u);const {file}=await multipart(req,5*1024*1024),bytes=new Uint8Array(await file.arrayBuffer());let type,ext;
    if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)){type='image/png';ext='png';}
    if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){type='image/jpeg';ext='jpg';}
    const h=new TextDecoder().decode(bytes.slice(0,12));if(h.startsWith('RIFF')&&h.slice(8)==='WEBP'){type='image/webp';ext='webp';}
    ensure(type&&file.type===type,'PNG/JPEG/WebP 이미지 파일만 등록하세요.');
    const newId=crypto.randomUUID(),key=`business/menus/${newId}.${ext}`;
    await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:type}});
    try{await env.DB.prepare('INSERT INTO meal_menus(id,week_start,file_key,owner,created_at) VALUES(?,?,?,?,?)').bind(newId,start,key,u.id,now()).run();}catch(e){await env.PHOTOS.delete(key);throw e;}
    return {id:newId};
  }
  ensure(req.method==='GET'&&idOk(id),'지원하지 않는 요청입니다.',405);
  const r=await env.DB.prepare('SELECT file_key FROM meal_menus WHERE id=?').bind(id).first();ensure(r,'식단표를 찾을 수 없습니다.',404);
  const object=await env.PHOTOS.get(r.file_key);ensure(object,'식단표 파일이 없습니다.',404);
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});object.writeHttpMetadata(headers);return new Response(object.body,{headers});
}
