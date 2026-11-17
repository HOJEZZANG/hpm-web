// HPM-only endpoint. Every database statement in this module is SELECT.
export const READ_PATH='/api/hpm/production-status';
const steps=['FU','WD','TP','EXP','MT','HYDRO'];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Allow':'GET'}});
const time=value=>{
  if(!value)return null;
  const text=String(value),iso=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text)?text.replace(' ','T')+'Z':text;
  return Number.isFinite(Date.parse(iso))?new Date(iso).toISOString():null;
};
async function equal(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const digest=s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  const [x,y]=await Promise.all([digest(a),digest(b)]);let difference=0;
  const left=new Uint8Array(x),right=new Uint8Array(y);for(let i=0;i<left.length;i++)difference|=left[i]^right[i];return difference===0;
}
export async function readOnlyProduction(request,env){
  const token=env.HPM_READ_TOKEN;
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/i.test(token)||await equal(token,String(env.ADMIN_TOKEN||'').trim()))return json({error:'조회 연동 인증 설정을 확인하세요.',code:'READ_SETUP_REQUIRED'},503);
  if(!await equal(request.headers.get('Authorization'),'Bearer '+token))return json({error:'조회 인증이 필요합니다.'},401);
  if(request.method!=='GET')return json({error:'조회만 가능합니다.'},405);
  if(!env.DB)return json({error:'조회 DB 설정을 확인하세요.',code:'READ_SETUP_REQUIRED'},503);
  const params=new URL(request.url).searchParams,limit=Number(params.get('limit')||500),after=params.get('after');
  if([...params.keys()].some(k=>!['limit','after'].includes(k))||[...params.keys()].some(k=>params.getAll(k).length!==1)||!Number.isInteger(limit)||limit<1||limit>500||after!==null&&(!after||after.length>1000))return json({error:'조회 조건을 확인하세요.'},400);
  try{
    const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('production_orders','production_steps')").all();
    if(tables.success===false||(tables.results||[]).length!==2)return json({error:'원본 생산 테이블 준비가 필요합니다.',code:'READ_SCHEMA_REQUIRED'},503);
    const columns=steps.map((code,i)=>`s${i}.completion_date AS ${code.toLowerCase()}`).join(', ');
    const joins=steps.map((code,i)=>`LEFT JOIN production_steps s${i} ON s${i}.work_order=o.work_order COLLATE BINARY AND s${i}.step_code='${code}'`).join('\n');
    const query=env.DB.prepare(`SELECT o.work_order,o.hull,o.project,o.equipment,
      o.shell_request_date,o.cond_completion_date,o.eva_completion_date,${columns}
      FROM production_orders o ${joins}
      ${after===null?'':'WHERE o.work_order COLLATE BINARY > ?'}
      ORDER BY o.work_order COLLATE BINARY LIMIT ?`).bind(...(after===null?[]:[after]),limit+1);
    // A read-only D1 batch gives metadata and rows from the same page transaction.
    const result=await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS total,MAX(updated_at) AS updated FROM production_orders'),
      env.DB.prepare("SELECT COUNT(*) AS total,MAX(updated_at) AS updated FROM production_steps WHERE step_code IN ('FU','WD','TP','EXP','MT','HYDRO')"),query,
    ]);
    if(result.length!==3||result.some(r=>r.success===false||!Array.isArray(r.results)))throw Error('read failed');
    const orders=result[0].results[0],extra=result[1].results[0],rows=result[2].results,hasMore=rows.length>limit,items=rows.slice(0,limit);
    const updated=[time(orders.updated),time(extra.updated)].filter(Boolean).sort().at(-1)||null;
    return json({schemaVersion:1,items,total:Number(orders.total),hasMore,nextCursor:hasMore?items.at(-1).work_order:null,
      revision:JSON.stringify([orders.total,orders.updated,extra.total,extra.updated]),sourceUpdatedAt:updated,queriedAt:new Date().toISOString()});
  }catch{return json({error:'원본 생산현황 조회에 실패했습니다.',code:'READ_FAILED'},503);}
}
