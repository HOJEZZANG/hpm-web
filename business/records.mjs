import {ensure,date,isoWeek,addDays,validateRecord} from './domain.mjs';
import {bodyJson} from './http.mjs';
import {collections,adminTypes,idOk,now,readRow,admin,own} from './access.mjs';
async function listRecords(env,type,url){
  const table=collections[type];let sql=`SELECT * FROM ${table}`,args=[];
  if(['weekly','safety'].includes(type)&&url.searchParams.get('week')){
    const week=isoWeek(date(url.searchParams.get('week'))).monday;sql+=' WHERE day>=? AND day<=?';args=[week,addDays(week,6)];
  }
  const {results}=await env.DB.prepare(sql+' ORDER BY updated_at DESC, id LIMIT 2001').bind(...args).all();
  ensure(results.length<=2000,'조회 범위가 큽니다. 주차로 좁혀 주세요.',413);return {records:results.map(readRow)};
}
export async function recordApi(req,env,u,type,id,url){
  const table=collections[type],method=req.method;
  if(!id&&method==='GET')return listRecords(env,type,url);
  ensure(idOk(id),'기록 ID를 확인하세요.');
  ensure(method==='PUT'||method==='DELETE','지원하지 않는 요청입니다.',405);
  if(adminTypes.has(type))admin(u);
  const previous=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  const body=await bodyJson(req);
  if(previous){own(u,previous);ensure(body.revision===previous.revision,'다른 PC에서 수정했습니다. 입력을 보관한 뒤 새로 조회해 비교하세요.',409);}
  if(method==='DELETE'){
    ensure(type==='weekly','이 업무는 개별 삭제 대신 수정/비활성화를 이용하세요.',405);
    if(!previous)return {deleted:false};
    const result=await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND revision=?`).bind(id,body.revision).run();ensure(result.meta.changes===1,'다른 PC에서 변경했습니다.',409);return {deleted:true};
  }
  const data=validateRecord(type,body),stamp=now(),day=data.date||'';
  if(!previous){
    ensure(!body.revision,'대상 기록이 삭제되었습니다. 새 기록으로 등록하세요.',409);
    const result=await env.DB.prepare(`INSERT INTO ${table}(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,u.id,JSON.stringify(data),day,stamp,stamp).run();
    ensure(result.meta.changes===1,'동일 ID 기록이 있습니다. 조회 후 다시 시도하세요.',409);
  }else{
    const result=await env.DB.prepare(`UPDATE ${table} SET data=?,day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(JSON.stringify(data),day,stamp,id,body.revision).run();ensure(result.meta.changes===1,'다른 PC에서 수정했습니다.',409);
  }
  return {record:readRow(await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first())};
}
