import {BusinessError,ensure,text} from './domain.mjs';
import {bodyJson} from './http.mjs';
import {auditStatement} from './audit.mjs';
const bytesHex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
const random=()=>bytesHex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
export async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return bytesHex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)));
}
export function constantEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const safeAccount=r=>{
  const profile=JSON.parse(r.profile||'{}');
  return {...Object.fromEntries(['team','officePhone','mobilePhone','email'].map(k=>[k,profile[k]||''])),
    id:r.id,employeeNo:r.employee_no||null,loginId:r.employee_no||r.id,name:r.name,role:r.role,status:r.status,
    authRevision:r.auth_revision||0,productionVerifiedAt:r.production_verified_at||null};
};
function authError(status,message,code){const e=new BusinessError(status,message);e.code=code;throw e;}
export async function authenticate(req,env){
  ensure(env.DB,'DB 연결을 확인하세요.',503);
  const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)authError(401,'서버 로그인이 필요합니다.','AUTH_REQUIRED');
  const row=await env.DB.prepare(`SELECT a.*,s.expires_at AS session_expires_at FROM portal_sessions s JOIN portal_accounts a ON a.id=s.user_id WHERE s.token_hash=?`).bind(await digest(token)).first();
  if(!row||row.session_expires_at<=new Date().toISOString())authError(401,'로그인이 만료되었습니다. 다시 로그인하세요.','SESSION_EXPIRED');
  if(row.status==='pending')authError(403,'관리자 가입 승인을 기다리고 있습니다.','ACCOUNT_PENDING');
  if(row.status!=='active')authError(403,'가입이 거절되었거나 이용이 중지된 계정입니다. 관리자에게 문의하세요.','ACCOUNT_DISABLED');
  return safeAccount(row);
}
async function throttle(req,env,action){
  const ip=req.headers.get('CF-Connecting-IP')||'local',key=await digest(action+':'+ip),stamp=Date.now(),cutoff=stamp-15*60000;
  const result=await env.DB.prepare(`INSERT INTO portal_auth_limits(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING attempts`).bind(key,stamp,cutoff,cutoff).first();
  ensure(result.attempts<=20,'로그인 요청이 많습니다. 15분 뒤 다시 시도하세요.',429);
}
function employeeNumber(value){
  const id=text(value,'사번',30,true);
  ensure(/^[a-zA-Z0-9._-]{1,30}$/.test(id),'사번은 영문·숫자·._- 1~30자로 입력하세요. 앞자리 0도 그대로 입력하세요.');return id;
}
function passwordValue(value){ensure(typeof value==='string'&&value.length>=12&&value.length<=128,'비밀번호는 12~128자로 입력하세요.');return value;}
function credentials(b){
  ensure(b&&typeof b==='object'&&!Array.isArray(b),'계정 정보를 입력하세요.');
  return {loginId:employeeNumber(b.employeeNo??b.id??''),password:passwordValue(b.password)};
}
function constraintError(error){
  if(/LAST_ACTIVE_ADMIN/.test(error.message))throw new BusinessError(409,'마지막 활성 관리자 계정은 중지하거나 관리자 권한을 해제할 수 없습니다.');
  if(/EMPLOYEE_LOGIN_CONFLICT|UNIQUE/.test(error.message))throw new BusinessError(409,'이미 사용 중인 사번 또는 기존 로그인 ID입니다. 기존 계정을 확인하세요.');
  throw error;
}
export async function authApi(req,env){
  ensure(env.DB,'DB 연결을 확인하세요.',503);const path=new URL(req.url).pathname;
  if(path==='/api/auth/status'&&req.method==='GET')return {setupRequired:!(await env.DB.prepare("SELECT id FROM portal_bootstrap WHERE id='initial'").first())};
  if(['/api/auth/login','/api/auth/register','/api/auth/bootstrap'].includes(path)&&req.method==='POST'){
    await throttle(req,env,path);const b=await bodyJson(req),{loginId,password}=credentials(b),id=loginId.toLowerCase();
    if(path!=='/api/auth/login'){
      const name=text(b.name??'','이름',100,true),salt=random(),hash=await passwordHash(password,salt);
      const bootstrap=path.endsWith('/bootstrap');
      if(bootstrap){
        ensure(typeof env.PORTAL_BOOTSTRAP_SECRET==='string'&&env.PORTAL_BOOTSTRAP_SECRET.length>=32,'관리자 최초 설정이 준비되지 않았습니다.',503);
        ensure(constantEqual(b.bootstrapSecret,env.PORTAL_BOOTSTRAP_SECRET),'관리자 최초 설정을 승인할 수 없습니다.',403);
        ensure(!await env.DB.prepare("SELECT id FROM portal_bootstrap WHERE id='initial'").first(),'최초 관리자 설정은 이미 완료되었습니다.',409);
      }
      const profile={team:text(b.team??'','소속',200)};
      const insert=env.DB.prepare('INSERT INTO portal_accounts(id,employee_no,name,salt,password_hash,role,status,profile,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,bootstrap?null:loginId,name,salt,hash,bootstrap?'admin':'user',bootstrap?'active':'pending',JSON.stringify(profile),new Date().toISOString());
      try{if(bootstrap)await env.DB.batch([env.DB.prepare("INSERT INTO portal_bootstrap(id) VALUES('initial')"),insert]);else await insert.run();}
      catch(e){constraintError(e);}
      return {registered:true,pending:!bootstrap};
    }
    const row=await env.DB.prepare('SELECT * FROM portal_accounts WHERE employee_no=? COLLATE NOCASE OR (employee_no IS NULL AND id=? COLLATE NOCASE)').bind(loginId,loginId).first();
    const hash=await passwordHash(password,row?.salt||'invalid-account-timing-placeholder');
    if(!row||!constantEqual(hash,row.password_hash))authError(401,'ID 또는 비밀번호를 확인하세요.','INVALID_CREDENTIALS');
    if(row.status==='pending')authError(403,'가입 신청이 승인 대기 중입니다. 관리자 승인 후 로그인하세요.','ACCOUNT_PENDING');
    if(row.status!=='active')authError(403,'가입이 거절되었거나 이용이 중지된 계정입니다. 관리자에게 문의하세요.','ACCOUNT_DISABLED');
    const token=random(),expiresAt=new Date(Date.now()+8*3600000).toISOString();
    const inserted=await env.DB.prepare("INSERT INTO portal_sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM portal_accounts WHERE id=? AND password_hash=? AND status='active'").bind(await digest(token),expiresAt,row.id,row.password_hash).run();
    ensure(inserted.meta.changes===1,'계정이 변경되었습니다. 다시 로그인하세요.',409);
    return {token,expiresAt,user:safeAccount(row)};
  }
  const user=await authenticate(req,env);
  if(path==='/api/auth/me'&&req.method==='GET')return {user};
  if(path==='/api/auth/logout'&&req.method==='POST'){
    const token=req.headers.get('Authorization').slice(7);await env.DB.prepare('DELETE FROM portal_sessions WHERE token_hash=?').bind(await digest(token)).run();return {loggedOut:true};
  }
  if(path==='/api/auth/password'&&req.method==='POST'){
    await throttle(req,env,'password:'+user.id);
    const b=await bodyJson(req),current=passwordValue(b.currentPassword),next=passwordValue(b.newPassword);
    ensure(!constantEqual(current,next),'현재 비밀번호와 다른 개인 비밀번호를 입력하세요.');
    const row=await env.DB.prepare('SELECT salt,password_hash FROM portal_accounts WHERE id=?').bind(user.id).first();
    ensure(constantEqual(await passwordHash(current,row.salt),row.password_hash),'현재 비밀번호를 확인하세요.',403);
    const salt=random(),hash=await passwordHash(next,salt);
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE portal_accounts SET salt=?,password_hash=?,auth_revision=auth_revision+1 WHERE id=? AND password_hash=?').bind(salt,hash,user.id,row.password_hash),
      auditStatement(env,user,'password.change',user.id,{},true),
      env.DB.prepare('DELETE FROM portal_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM portal_accounts WHERE id=? AND password_hash=?)').bind(user.id,user.id,hash),
    ]);
    ensure(results[0].meta.changes===1,'다른 요청에서 비밀번호가 변경되었습니다. 다시 로그인하세요.',409);
    return {changed:true,reauthenticate:true};
  }
  if(path==='/api/auth/profile'&&req.method==='PUT'){
    const b=await bodyJson(req),name=text(b.name??'','이름',100,true),profile={};
    for(const k of ['team','officePhone','mobilePhone','email'])profile[k]=text(b[k]??'',k,200);
    await env.DB.prepare('UPDATE portal_accounts SET name=?,profile=? WHERE id=?').bind(name,JSON.stringify(profile),user.id).run();return {user:{...user,...profile,name}};
  }
  if(path==='/api/auth/users'&&req.method==='GET'){
    ensure(user.role==='admin','관리자 권한이 필요합니다.',403);
    return {users:(await env.DB.prepare('SELECT id,employee_no,name,role,status,profile,auth_revision,production_verified_at FROM portal_accounts ORDER BY created_at').all()).results.map(safeAccount)};
  }
  if(path==='/api/auth/audit'&&req.method==='GET'){
    ensure(user.role==='admin','관리자 권한이 필요합니다.',403);
    const before=new URL(req.url).searchParams.get('before')||'9223372036854775807';ensure(/^\d{1,19}$/.test(before),'이력 조회 위치를 확인하세요.');
    const {results}=await env.DB.prepare('SELECT id,actor_id,actor_name,action,target_id,details,at FROM portal_audit WHERE id<CAST(? AS INTEGER) ORDER BY id DESC LIMIT 100').bind(before).all();
    return {records:results.map(r=>({...r,details:JSON.parse(r.details)})),next:results.length===100?String(results.at(-1).id):null};
  }
  const match=path.match(/^\/api\/auth\/users\/([a-z0-9._-]{1,30})$/);
  if(match&&req.method==='PUT'){
    ensure(user.role==='admin','관리자 권한이 필요합니다.',403);const b=await bodyJson(req);
    const old=await env.DB.prepare('SELECT * FROM portal_accounts WHERE id=?').bind(match[1]).first();ensure(old,'계정을 찾을 수 없습니다.',404);
    const status=b.status??old.status,role=b.role??old.role,employeeNo=Object.hasOwn(b,'employeeNo')?employeeNumber(b.employeeNo):old.employee_no;
    ensure(['active','disabled','pending'].includes(status),'계정 상태를 확인하세요.');ensure(['admin','user'].includes(role),'계정 권한을 확인하세요.');
    const accessChanged=status!==old.status||role!==old.role,numberChanged=employeeNo!==old.employee_no;
    ensure(old.id!==user.id||!accessChanged,'본인 계정의 상태·권한은 다른 관리자에게 요청하세요.');
    if(numberChanged||(accessChanged&&(old.role==='admin'||role==='admin')))ensure(b.confirmation===old.id,'대상 계정과 변경 내용을 명확히 확인해 주세요.');
    const granting=role==='admin'&&status==='active'&&(old.role!=='admin'||old.status!=='active');
    if(granting){ensure(employeeNo,'확인한 사번을 먼저 지정하세요.');ensure(b.productionMemberConfirmed===true,'실제 생산관리팀원인지 확인한 뒤 관리자 승인을 선택하세요.');}
    ensure(!(old.role!=='admin'&&role==='admin'&&status!=='active'),'관리자 승격은 실제 팀원 확인과 활성 승인을 함께 진행하세요.');
    if(!accessChanged&&!numberChanged)return {updated:false,user:safeAccount(old)};
    const revision=b.authRevision??old.auth_revision;ensure(Number.isSafeInteger(revision)&&revision===old.auth_revision,'다른 관리자가 계정을 변경했습니다. 새로 조회하세요.',409);
    const verifiedAt=granting?new Date().toISOString():old.production_verified_at,verifiedBy=granting?user.id:old.production_verified_by;
    try{
      const results=await env.DB.batch([
        env.DB.prepare('UPDATE portal_accounts SET employee_no=?,role=?,status=?,auth_revision=auth_revision+1,production_verified_at=?,production_verified_by=? WHERE id=? AND auth_revision=?').bind(employeeNo,role,status,verifiedAt,verifiedBy,old.id,revision),
        auditStatement(env,user,'account.update',old.id,{before:{employeeNo:old.employee_no,role:old.role,status:old.status},after:{employeeNo,role,status},productionMemberConfirmed:granting},true),
      ]);
      ensure(results[0].meta.changes===1,'다른 관리자가 계정을 변경했습니다. 새로 조회하세요.',409);
    }catch(e){constraintError(e);}
    return {updated:true,user:safeAccount(await env.DB.prepare('SELECT * FROM portal_accounts WHERE id=?').bind(old.id).first())};
  }
  throw new BusinessError(404,'인증 API를 찾을 수 없습니다.');
}
