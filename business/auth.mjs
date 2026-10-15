import {BusinessError,ensure,text} from './domain.mjs';
import {bodyJson} from './http.mjs';
const bytesHex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
const random=()=>bytesHex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
export async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return bytesHex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)));
}
export function constantEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const safeAccount=r=>({...JSON.parse(r.profile||'{}'),id:r.id,name:r.name,role:r.role,status:r.status});
export async function authenticate(req,env){
  ensure(env.DB,'DB 연결을 확인하세요.',503);
  const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];ensure(token,'서버 로그인이 필요합니다.',401);
  const row=await env.DB.prepare(`SELECT a.* FROM portal_sessions s JOIN portal_accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.status='active'`).bind(await digest(token),new Date().toISOString()).first();
  ensure(row,'로그인이 만료되었거나 접근 권한이 없습니다. 다시 로그인하세요.',401);return safeAccount(row);
}
async function throttle(req,env,action){
  const ip=req.headers.get('CF-Connecting-IP')||'local',key=await digest(action+':'+ip),stamp=Date.now(),cutoff=stamp-15*60000;
  const result=await env.DB.prepare(`INSERT INTO portal_auth_limits(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING attempts`).bind(key,stamp,cutoff,cutoff).first();
  ensure(result.attempts<=20,'로그인 요청이 많습니다. 15분 뒤 다시 시도하세요.',429);
}
function credentials(b){
  ensure(b&&typeof b==='object','계정 정보를 입력하세요.');const id=text(b.id??'','ID',30,true).toLowerCase();ensure(/^[a-z0-9._-]{3,30}$/.test(id),'ID는 영문 소문자/숫자/._- 3~30자입니다.');
  ensure(typeof b.password==='string'&&b.password.length>=12&&b.password.length<=128,'비밀번호는 12~128자로 입력하세요.');return {id,password:b.password};
}
export async function authApi(req,env){
  ensure(env.DB,'DB 연결을 확인하세요.',503);const path=new URL(req.url).pathname;
  if(path==='/api/auth/status'&&req.method==='GET')return {setupRequired:!(await env.DB.prepare("SELECT id FROM portal_bootstrap WHERE id='initial'").first())};
  if(['/api/auth/login','/api/auth/register','/api/auth/bootstrap'].includes(path)&&req.method==='POST'){
    await throttle(req,env,path);const b=await bodyJson(req),{id,password}=credentials(b);
    if(path!=='/api/auth/login'){
      const name=text(b.name??'','이름',100,true),salt=random(),hash=await passwordHash(password,salt);
      const bootstrap=path.endsWith('/bootstrap');
      if(bootstrap){
        ensure(typeof env.PORTAL_BOOTSTRAP_SECRET==='string'&&env.PORTAL_BOOTSTRAP_SECRET.length>=32,'관리자 최초 설정이 준비되지 않았습니다.',503);
        ensure(constantEqual(b.bootstrapSecret,env.PORTAL_BOOTSTRAP_SECRET),'관리자 최초 설정을 승인할 수 없습니다.',403);
        ensure(!await env.DB.prepare("SELECT id FROM portal_bootstrap WHERE id='initial'").first(),'최초 관리자 설정은 이미 완료되었습니다.',409);
      }
      const insert=env.DB.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,name,salt,hash,bootstrap?'admin':'user',bootstrap?'active':'pending',new Date().toISOString());
      try{if(bootstrap)await env.DB.batch([env.DB.prepare("INSERT INTO portal_bootstrap(id) VALUES('initial')"),insert]);else await insert.run();}
      catch(e){if(/UNIQUE|constraint/i.test(e.message))throw new BusinessError(409,'이미 등록된 계정 또는 완료된 최초 설정입니다. 관리자에게 문의하세요.');throw e;}
      return {registered:true,pending:!bootstrap};
    }
    const row=await env.DB.prepare('SELECT * FROM portal_accounts WHERE id=?').bind(id).first();
    const hash=await passwordHash(password,row?.salt||'invalid-account-timing-placeholder');
    ensure(row&&constantEqual(hash,row.password_hash)&&row.status==='active','계정 또는 비밀번호를 확인하세요. 신규 계정은 관리자 승인이 필요합니다.',401);
    const token=random(),expiresAt=new Date(Date.now()+8*3600000).toISOString();
    await env.DB.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),id,expiresAt).run();
    return {token,expiresAt,user:safeAccount(row)};
  }
  const user=await authenticate(req,env);
  if(path==='/api/auth/me'&&req.method==='GET')return {user};
  if(path==='/api/auth/logout'&&req.method==='POST'){
    const token=req.headers.get('Authorization').slice(7);await env.DB.prepare('DELETE FROM portal_sessions WHERE token_hash=?').bind(await digest(token)).run();return {loggedOut:true};
  }
  if(path==='/api/auth/profile'&&req.method==='PUT'){
    const b=await bodyJson(req),name=text(b.name??'','이름',100,true),profile={};
    for(const k of ['team','officePhone','mobilePhone','email'])profile[k]=text(b[k]??'',k,200);
    await env.DB.prepare('UPDATE portal_accounts SET name=?,profile=? WHERE id=?').bind(name,JSON.stringify(profile),user.id).run();return {user:{...user,...profile,name}};
  }
  if(path==='/api/auth/users'&&req.method==='GET'){
    ensure(user.role==='admin','관리자 권한이 필요합니다.',403);
    return {users:(await env.DB.prepare('SELECT id,name,role,status,profile FROM portal_accounts ORDER BY created_at').all()).results.map(safeAccount)};
  }
  const match=path.match(/^\/api\/auth\/users\/([a-z0-9._-]{3,30})$/);
  if(match&&req.method==='PUT'){
    ensure(user.role==='admin','관리자 권한이 필요합니다.',403);const b=await bodyJson(req);
    ensure(['active','disabled','pending'].includes(b.status),'계정 상태를 확인하세요.');ensure(match[1]!==user.id,'본인 계정 상태는 변경할 수 없습니다.');
    const r=await env.DB.prepare("UPDATE portal_accounts SET status=? WHERE id=? AND role='user'").bind(b.status,match[1]).run();ensure(r.meta.changes===1,'일반 사용자 계정만 변경할 수 있습니다.',404);return {updated:true};
  }
  throw new BusinessError(404,'인증 API를 찾을 수 없습니다.');
}
