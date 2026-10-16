import {ensure,text} from './domain.mjs';
import {collections} from './access.mjs';
export async function search(env,u,url){
  const q=text(url.searchParams.get('q')??'','검색어',100,true);ensure(q.length>=2,'검색어는 2자 이상 입력하세요.');
  const records=[];const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  for(const [type,table] of Object.entries(collections)){
    if(['safety','vehicles'].includes(type))continue;
    const {results}=await env.DB.prepare(`SELECT * FROM ${table} WHERE data LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 30`).bind(pattern).all();
    records.push(...results.map(r=>({type,id:r.id,label:JSON.parse(r.data).title||JSON.parse(r.data).product||JSON.parse(r.data).name||JSON.parse(r.data).number||JSON.parse(r.data).factory})));
  }
  for(const [type,table,label,columns] of [['issue','issues','title',['title','description','project_no']],['as','as_events','hull_no',['hull_no','yard','as_detail','worker_info']],['team','team_events','title',['title','detail','location','members']]]){
    const {results}=await env.DB.prepare(`SELECT id,${label} AS label FROM ${table} WHERE ${columns.map(c=>`${c} LIKE ? ESCAPE '\\'`).join(' OR ')} LIMIT 30`).bind(...columns.map(()=>pattern)).all();records.push(...results.map(r=>({...r,type})));
  }
  for(const [type,table,kind] of [['production','production_rows','production'],['supplies','supply_items','supplies']]){
    const {results}=await env.DB.prepare(`SELECT id,data FROM ${table} WHERE data LIKE ? ESCAPE '\\' LIMIT 30`).bind(pattern).all();
    records.push(...results.map(r=>{const d=JSON.parse(r.data);return {id:r.id,type,label:kind==='production'?[d['제조사양관리구분']||d['분류']||d['LINE 5000'],d.Yard,d.HullNo,d['현공정']].filter(Boolean).join(' / '):kind==='supplies'?[d['품목코드'],d['품목명'],d['규격']].filter(Boolean).join(' / '):[d.applicant,d.purpose].join(' / ')};}));
  }
  const orders=(await env.DB.prepare(`SELECT id,applicant,purpose FROM supply_orders WHERE (applicant LIKE ? ESCAPE '\\' OR purpose LIKE ? ESCAPE '\\' OR lines LIKE ? ESCAPE '\\')${u.role==='admin'?'':' AND owner=?'} LIMIT 30`).bind(pattern,pattern,pattern,...(u.role==='admin'?[]:[u.id])).all()).results;
  records.push(...orders.map(r=>({id:r.id,type:'supplies',label:r.applicant+' / '+r.purpose})));
  return {records};
}
