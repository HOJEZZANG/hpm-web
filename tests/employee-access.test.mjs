import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev',password='synthetic-personal-password';
const request=(env,path,method='GET',body,token=TOKEN)=>worker.fetch(new Request(base+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
const ok=async response=>{const r=await response,b=await r.json();assert.equal(r.status,200,b.error);return b;};
const signup=(env,id,extra={})=>ok(request(env,'/api/auth/register','POST',{id,name:'합성 팀원',password,...extra},null));
const login=(env,id,p=password)=>ok(request(env,'/api/auth/login','POST',{id,password:p},null));
const update=(env,id,changes,token=TOKEN)=>request(env,'/api/auth/users/'+id,'PUT',changes,token);
const grant=(env,id,extra={})=>ok(update(env,id,{role:'admin',status:'active',productionMemberConfirmed:true,confirmation:id,...extra}));
const weekly={date:'2026-10-27',part:'1 PART',product:'합성 제품',problem:'합성 문제',manager:'합성 담당'};

test('additive employee migration preserves every legacy account, password, session and owner',()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0005_server_identity.sql',import.meta.url),'utf8'));
  for(const [id,role,status] of [['legacy','admin','active'],['member','user','active'],['waiting','user','pending']])db.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'합성','salt','hash',role,status,'2026-01-01');
  db.prepare('INSERT INTO portal_sessions VALUES(?,?,?)').run('hash','legacy','2099-01-01');
  const before=db.prepare('SELECT * FROM portal_accounts ORDER BY id').all();
  db.exec(readFileSync(new URL('../migrations/0006_employee_access.sql',import.meta.url),'utf8'));
  const after=db.prepare('SELECT * FROM portal_accounts ORDER BY id').all();
  for(let i=0;i<before.length;i++){for(const k of Object.keys(before[i]))assert.equal(after[i][k],before[i][k]);assert.equal(after[i].employee_no,null);assert.equal(after[i].auth_revision,0);}
  assert.equal(db.prepare('SELECT user_id FROM portal_sessions').get().user_id,'legacy');
  assert.equal(db.prepare('SELECT count(*) n FROM portal_audit').get().n,0);db.close();
});

test('employee signup retains zeroes, rejects numeric or duplicate IDs, and never trusts team/role',async()=>{
  const env=makeEnv();await signup(env,'000123',{team:'생산관리팀',role:'admin',status:'active',productionMemberConfirmed:true});await signup(env,'123');
  const row=env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='000123'").get();assert.equal(row.employee_no,'000123');assert.equal(row.role,'user');assert.equal(row.status,'pending');assert.notEqual(row.password_hash,password);assert.equal(row.salt.length,64);
  const hash=row.password_hash;assert.equal((await request(env,'/api/auth/register','POST',{id:'000123',name:'합성',password:'different-synthetic-password'},null)).status,409);
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000123'").get().password_hash,hash);
  assert.equal((await request(env,'/api/auth/register','POST',{id:123,name:'합성',password},null)).status,400);
  assert.equal((await request(env,'/api/auth/login','POST',{id:'000123',password},null)).status,403);
  await signup(env,'AB-0001');assert.equal((await request(env,'/api/auth/register','POST',{id:'ab-0001',name:'합성',password},null)).status,409);
});

test('explicit verification grants all admin capabilities to a single approved employee; ordinary approval stays ordinary',async()=>{
  const env=makeEnv();await signup(env,'001001');await signup(env,'001002');
  await ok(update(env,'001001',{status:'active'}));const member=await login(env,'001001');assert.equal(member.user.role,'user');
  await ok(update(env,'001002',{status:'active'}));assert.equal((await login(env,'001002')).user.role,'user');
  assert.equal((await update(env,'001001',{role:'admin',confirmation:'001001'})).status,400);
  assert.equal((await update(env,'001001',{role:'admin',productionMemberConfirmed:true})).status,400);
  await grant(env,'001001');const me=await ok(request(env,'/api/auth/me','GET',undefined,member.token));assert.equal(me.user.role,'admin');assert(me.user.productionVerifiedAt);
  await ok(request(env,'/api/business/weekly/other-owner','PUT',weekly));
  await ok(request(env,'/api/business/weekly/other-owner','PUT',{...weekly,problem:'관리자 수정',revision:1},member.token));
  await ok(request(env,'/api/business/weekly/other-owner','DELETE',{revision:2},member.token));
  await ok(request(env,'/api/business/notices/notice','PUT',{title:'합성 공지',content:'내용'},member.token));
  await ok(request(env,'/api/auth/users','GET',undefined,member.token));
  await ok(request(env,'/api/issues/other-owner','PUT',{description:'합성 문제'}));await ok(request(env,'/api/issues/other-owner','DELETE',undefined,member.token));
  const regular=await login(env,'001002');assert.equal((await request(env,'/api/business/notices/forged','PUT',{title:'위조',content:'내용',role:'admin'},regular.token)).status,403);
  assert.equal((await request(env,'/api/auth/users','GET',undefined,regular.token)).status,403);
  await ok(request(env,'/api/business/weekly/protected','PUT',weekly));
  assert.equal((await request(env,'/api/business/weekly/protected','PUT',{...weekly,revision:1,role:'admin'},regular.token)).status,403);
  assert.equal((await request(env,'/api/business/weekly/protected','DELETE',{revision:1},regular.token)).status,403);
  await ok(request(env,'/api/issues/protected','PUT',{description:'합성 등록자 자료'}));
  assert.equal((await request(env,'/api/issues/protected','DELETE',undefined,regular.token)).status,403);
});

test('legacy account converts to a confirmed employee login without changing ownership, history, password or session',async()=>{
  const env=makeEnv();await signup(env,'legacy-person');await ok(update(env,'legacy-person',{status:'active'}));
  env.sqlite.prepare("UPDATE portal_accounts SET employee_no=NULL WHERE id='legacy-person'").run();
  const old=await login(env,'legacy-person');await ok(request(env,'/api/business/weekly/kept','PUT',weekly,old.token));
  await ok(request(env,'/api/issues/kept','PUT',{description:'合成',history:[{actor:'합성 등록자',at:'2026-01-01',note:'등록'}]},old.token));
  const record=env.sqlite.prepare("SELECT * FROM issues WHERE id='kept'").get(),row=env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='legacy-person'").get();
  await ok(update(env,'legacy-person',{employeeNo:'000077',confirmation:'legacy-person',authRevision:row.auth_revision}));
  const migrated=await login(env,'000077');assert.equal(migrated.user.id,'legacy-person');assert.equal(migrated.user.loginId,'000077');
  assert.equal((await request(env,'/api/auth/login','POST',{id:'legacy-person',password},null)).status,401);
  assert.equal((await ok(request(env,'/api/auth/me','GET',undefined,old.token))).user.employeeNo,'000077');
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='legacy-person'").get().password_hash,row.password_hash);
  assert.deepEqual(env.sqlite.prepare("SELECT * FROM issues WHERE id='kept'").get(),record);
  assert.equal(env.sqlite.prepare("SELECT owner FROM weekly_issues WHERE id='kept'").get().owner,'legacy-person');
  assert.equal((await update(env,'legacy-person',{employeeNo:77,confirmation:'legacy-person'})).status,400);
  assert.equal((await request(env,'/api/auth/register','POST',{id:'000077',name:'합성',password},null)).status,409);
  await signup(env,'second');assert.equal((await update(env,'second',{employeeNo:'000077',confirmation:'second'})).status,409);
  assert.equal((await update(env,'second',{employeeNo:'owner',confirmation:'second'})).status,409);
  await grant(env,'legacy-person');assert.equal((await ok(request(env,'/api/auth/me','GET',undefined,old.token))).user.role,'admin');
});

test('role changes, revocation and reapproval apply to existing sessions and resist stale/forged updates',async()=>{
  const env=makeEnv();await signup(env,'000201');await ok(update(env,'000201',{status:'active'}));const u=await login(env,'000201');
  assert.equal((await update(env,'owner',{role:'user',status:'disabled',confirmation:'owner'},u.token)).status,403);
  await grant(env,'000201');const revision=(await ok(request(env,'/api/auth/me','GET',undefined,u.token))).user.authRevision;
  await ok(update(env,'000201',{role:'user',confirmation:'000201',authRevision:revision}));
  assert.equal((await request(env,'/api/auth/users','GET',undefined,u.token)).status,403);
  assert.equal((await ok(request(env,'/api/auth/me','GET',undefined,u.token))).user.role,'user');
  const count=env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n;
  assert.equal((await update(env,'000201',{status:'disabled',authRevision:revision})).status,409);
  assert.equal(env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n,count);
  await grant(env,'000201');assert.equal((await update(env,'000201',{status:'disabled'})).status,400);
  await ok(update(env,'000201',{status:'disabled',confirmation:'000201'}));
  let r=await request(env,'/api/auth/me','GET',undefined,u.token);assert.equal(r.status,403);assert.equal((await r.json()).code,'ACCOUNT_DISABLED');
  assert.equal((await update(env,'000201',{status:'active',confirmation:'000201'})).status,400);
  await grant(env,'000201');await ok(request(env,'/api/auth/logout','POST',undefined,u.token));assert.equal((await request(env,'/api/auth/me','GET',undefined,u.token)).status,401);
});

test('SQLite guards the last active administrator and rolls back failed concurrent removal',async()=>{
  const env=makeEnv();assert.throws(()=>env.sqlite.prepare("UPDATE portal_accounts SET status='disabled' WHERE id='owner'").run(),/LAST_ACTIVE_ADMIN/);
  assert.throws(()=>env.sqlite.prepare("UPDATE portal_accounts SET role='user' WHERE id='owner'").run(),/LAST_ACTIVE_ADMIN/);
  assert.throws(()=>env.sqlite.prepare("DELETE FROM portal_accounts WHERE id='owner'").run(),/LAST_ACTIVE_ADMIN/);
  await signup(env,'000301');await grant(env,'000301');
  const attempts=await Promise.allSettled(['owner','000301'].map(id=>env.DB.batch([env.DB.prepare("UPDATE portal_accounts SET role='user' WHERE id=?").bind(id)])));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
  assert.equal(env.sqlite.prepare("SELECT count(*) n FROM portal_accounts WHERE role='admin' AND status='active'").get().n,1);
});

test('personal password change needs current password, never leaks credentials, and revokes all sessions',async()=>{
  const env=makeEnv();await signup(env,'000401');await ok(update(env,'000401',{status:'active'}));const a=await login(env,'000401'),b=await login(env,'000401');
  const before=env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='000401'").get();
  assert.equal((await request(env,'/api/auth/password','POST',{currentPassword:'wrong-synthetic-password',newPassword:'new-synthetic-password'},a.token)).status,403);
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000401'").get().password_hash,before.password_hash);
  await ok(request(env,'/api/auth/password','POST',{currentPassword:password,newPassword:'new-synthetic-password',userId:'owner',role:'admin'},a.token));
  const after=env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='000401'").get();assert.notEqual(after.salt,before.salt);assert.notEqual(after.password_hash,before.password_hash);assert.equal(after.role,'user');
  for(const token of [a.token,b.token])assert.equal((await request(env,'/api/auth/me','GET',undefined,token)).status,401);
  assert.equal((await request(env,'/api/auth/login','POST',{id:'000401',password},null)).status,401);await login(env,'000401','new-synthetic-password');
  const users=await ok(request(env,'/api/auth/users'));assert(!JSON.stringify(users).includes(after.password_hash));assert(!JSON.stringify(users).includes(after.salt));assert(!JSON.stringify(users).includes('password'));
  const history=await ok(request(env,'/api/auth/audit'));assert(!JSON.stringify(history).includes(password));assert(!JSON.stringify(history).includes('new-synthetic-password'));assert.equal(history.records[0].action,'password.change');
});

test('major administrator writes record a trusted actor and server time; audit is admin-only and paginated',async()=>{
  const env=makeEnv();await signup(env,'000501');await ok(update(env,'000501',{status:'active'}));const u=await login(env,'000501');
  await ok(request(env,'/api/business/weekly/audit','PUT',{...weekly,actor:'forged',at:'1900-01-01'}));
  const audit=await ok(request(env,'/api/auth/audit'));assert.equal(audit.records[0].actor_id,'owner');assert.equal(audit.records[0].actor_name,'등록자');assert.match(audit.records[0].at,/^20\d\d-/);assert.match(audit.records[0].action,/PUT.*weekly/);
  assert.equal((await request(env,'/api/auth/audit','GET',undefined,u.token)).status,403);
  const older=await ok(request(env,'/api/auth/audit?before='+audit.records[0].id));assert(older.records.every(r=>r.id<audit.records[0].id));
  const initial=env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n;
  assert.equal((await request(env,'/api/business/notices/forged','PUT',{title:'위조',content:'내용',role:'admin'},u.token)).status,403);
  assert.equal(env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n,initial);
});
