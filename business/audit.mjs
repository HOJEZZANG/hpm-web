// Only server-selected metadata belongs here. Never pass request bodies or credentials.
export function auditStatement(env,user,action,targetId,details={},conditional=false){
  return env.DB.prepare(`INSERT INTO portal_audit(actor_id,actor_name,action,target_id,details,at)
    SELECT ?,?,?,?,?,?${conditional?' WHERE changes()=1':''}`)
    .bind(user.id,user.name,action,targetId,JSON.stringify(details),new Date().toISOString());
}
export async function auditRequest(env,user,req){
  if(user?.role!=='admin'||!['POST','PUT','DELETE'].includes(req.method))return;
  const path=new URL(req.url).pathname;
  await auditStatement(env,user,req.method+' '+path,path).run();
}
