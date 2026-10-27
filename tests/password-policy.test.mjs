// All passwords and identities in these tests are synthetic. No production calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker.js';
import {passwordHash} from '../business/auth.mjs';
import {newPasswordError} from '../business/password-policy.mjs';
import {reserveCredentialCheck,finishCredentialCheck,LOGIN_WINDOW_MS} from '../business/login-limit.mjs';
import {makeEnv,TOKEN} from './support/env.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev',legacyPassword='Legacy-Admin!2026-Old';
const request=(env,path,method='GET',body,token,ip='192.0.2.1')=>worker.fetch(new Request(base+path,{method,headers:{Origin:'https://hojezzang.github.io','CF-Connecting-IP':ip,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
const ok=async promise=>{const r=await promise,b=await r.json();assert.equal(r.status,200,b.error);return b;};
const login=(env,id,password,ip)=>request(env,'/api/auth/login','POST',{id,password},null,ip);
const signup=(env,id,password,extra={})=>request(env,'/api/auth/register','POST',{id,name:'합성 팀원',password,team:'생산관리팀',...extra});
async function member(env,id='000071',password='0123'){
  await ok(signup(env,id,password));await ok(request(env,'/api/auth/users/'+id,'PUT',{status:'active'},TOKEN));return id;
}
async function legacy(env){env.sqlite.prepare("UPDATE portal_accounts SET password_hash=? WHERE id='owner'").run(await passwordHash(legacyPassword,'synthetic'));}

test('new numeric policy accepts raw zero-prefixed strings and rejects all non-digit forms, including trailing newline',async()=>{
  const env=makeEnv();
  for(const [i,password] of ['',1234,null,'123','-1234','12.34','12a4','12!4',' 0123','0123 ','0123\n','０１２３','0'.repeat(129)].entries()){
    assert(newPasswordError(password,'numeric'));assert.equal((await signup(env,'bad-'+i,password,{passwordPolicy:'legacy'})).status,400);
  }
  assert.equal(env.sqlite.prepare('SELECT count(*) n FROM portal_accounts').get().n,1);
  for(const [id,p] of [['000071','0123'],['000072','0000'],['000073','0'.repeat(128)]]){await member(env,id,p);const r=await ok(login(env,id,p));assert.equal(r.user.passwordPolicy,'numeric');assert.equal(r.user.role,'user');}
  assert.equal((await login(env,'000071','123')).status,401);
  const row=env.sqlite.prepare("SELECT salt,password_hash FROM portal_accounts WHERE id='000071'").get();assert.equal(row.password_hash,await passwordHash('0123',row.salt));assert.notEqual(row.password_hash,await passwordHash('123',row.salt));
});

test('new member keeps the numeric password and policy after administrator approval and through changes',async()=>{
  const env=makeEnv();await member(env);const before=env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000071'").get().password_hash;
  await ok(request(env,'/api/auth/users/000071','PUT',{role:'admin',status:'active',productionMemberConfirmed:true,confirmation:'000071',passwordPolicy:'legacy'},TOKEN));
  const session=await ok(login(env,'000071','0123'));assert.equal(session.user.role,'admin');assert.equal(session.user.passwordPolicy,'numeric');assert.equal(env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000071'").get().password_hash,before);
  assert.equal((await request(env,'/api/auth/password','POST',{currentPassword:'0123',newPassword:'Numeric-Bypass!2026',passwordPolicy:'legacy'},session.token)).status,400);
  assert.equal((await request(env,'/api/auth/password','POST',{currentPassword:'0123',newPassword:1234},session.token)).status,400);
  await ok(request(env,'/api/auth/password','POST',{currentPassword:'0123',newPassword:'0000'},session.token));
  assert.equal((await request(env,'/api/auth/me','GET',undefined,session.token)).status,401);const changed=await ok(login(env,'000071','0000'));assert.equal(changed.user.role,'admin');assert.equal(changed.user.passwordPolicy,'numeric');
  assert.throws(()=>env.sqlite.prepare("UPDATE portal_accounts SET password_policy='legacy' WHERE id='000071'").run(),/PASSWORD_POLICY_IMMUTABLE/);
});

test('existing administrator mixed password remains valid and may change to another mixed password',async()=>{
  const env=makeEnv();await legacy(env);const before=env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='owner'").get();
  const a=await ok(login(env,'owner',legacyPassword)),b=await ok(login(env,'OWNER',legacyPassword));assert.equal(a.user.passwordPolicy,'legacy');assert.equal(a.user.role,'admin');
  assert.deepEqual(env.sqlite.prepare("SELECT * FROM portal_accounts WHERE id='owner'").get(),before,'Logging in never rewrites passwords, policy or account state');
  await ok(request(env,'/api/auth/password','POST',{currentPassword:legacyPassword,newPassword:'Next-Admin!2026-Private',passwordPolicy:'numeric'},a.token));
  for(const token of [a.token,b.token])assert.equal((await request(env,'/api/auth/me','GET',undefined,token)).status,401);
  const result=await ok(login(env,'owner','Next-Admin!2026-Private'));assert.equal(result.user.passwordPolicy,'legacy');assert.equal(result.user.role,'admin');
});

test('password-policy migration preserves all existing values, hashes, approvals and sessions',()=>{
  const db=new DatabaseSync(':memory:');for(const name of ['0005_server_identity.sql','0006_employee_access.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  for(const[id,role,status]of [['old-admin','admin','active'],['old-user','user','active'],['waiting','user','pending']])db.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'합성','salt','unchanged-hash',role,status,'2026-01-01');
  db.prepare('INSERT INTO portal_sessions VALUES(?,?,?)').run('unchanged-token-hash','old-admin','2099-01-01');
  const before=db.prepare('SELECT * FROM portal_accounts ORDER BY id').all();db.exec(readFileSync(new URL('../migrations/0007_password_policy.sql',import.meta.url),'utf8'));
  const after=db.prepare('SELECT * FROM portal_accounts ORDER BY id').all();for(let i=0;i<before.length;i++){for(const k of Object.keys(before[i]))assert.equal(after[i][k],before[i][k]);assert.equal(after[i].password_policy,'legacy');}
  assert.equal(db.prepare('SELECT token_hash FROM portal_sessions').get().token_hash,'unchanged-token-hash');assert.equal(db.prepare('SELECT count(*) n FROM portal_login_limits').get().n,0);db.close();
});

test('all accounts lock after five failures across IPs, return retry time, and recover automatically',async t=>{
  const env=makeEnv();await legacy(env);await member(env);let stamp=Date.now();t.mock.method(Date,'now',()=>stamp);
  for(const[id,password]of [['owner',legacyPassword],['000071','0123']]){
    const live=await ok(login(env,id,password));
    for(let i=0;i<5;i++){const r=await login(env,i%2?id.toUpperCase():id,'bad-guess','192.0.2.'+(10+i));assert.equal(r.status,401);if(i===4){assert.equal(r.headers.get('Retry-After'),'900');assert.equal((await r.json()).retryAfterSeconds,900);}}
    const denied=await login(env,id,password,'198.51.100.1');assert.equal(denied.status,429);assert.equal((await denied.json()).code,'LOGIN_RETRY');
    await ok(request(env,'/api/auth/me','GET',undefined,live.token));
    assert.equal(env.sqlite.prepare('SELECT status FROM portal_accounts WHERE id=?').get(id).status,'active');
    stamp+=LOGIN_WINDOW_MS+1;await ok(login(env,id,password,'198.51.100.1'));
  }
});

test('successful login clears only its account failures; other accounts at the same office IP stay usable',async()=>{
  const env=makeEnv();await legacy(env);await member(env);
  for(let round=0;round<2;round++){for(let i=0;i<4;i++)assert.equal((await login(env,'000071','bad-guess')).status,401);await ok(login(env,'000071','0123'));}
  for(let i=0;i<5;i++)assert.equal((await login(env,'000071','bad-guess')).status,401);
  assert.equal((await login(env,'000071','0123')).status,429);await ok(login(env,'owner',legacyPassword));
});

test('IP failure budget also limits distributed usernames without exposing whether an account exists',async t=>{
  const env=makeEnv();await legacy(env);let stamp=Date.now();t.mock.method(Date,'now',()=>stamp);
  for(let i=0;i<30;i++)assert.equal((await login(env,'unknown-'+i,'bad-guess')).status,401);
  assert.equal((await login(env,'owner',legacyPassword)).status,429);await ok(login(env,'owner',legacyPassword,'198.51.100.2'));
  stamp+=LOGIN_WINDOW_MS+1;await ok(login(env,'owner',legacyPassword));
});

test('atomic reservations cap concurrent guesses and an older success cannot erase a newer failure',async()=>{
  const env=makeEnv();await member(env);
  const responses=await Promise.all(Array.from({length:20},(_,i)=>login(env,'000071','bad-guess','192.0.2.'+(i+1))));
  assert.equal(responses.filter(r=>r.status===401).length,5);assert.equal(responses.filter(r=>r.status===429).length,15);
  const rows=env.sqlite.prepare('SELECT * FROM portal_login_limits').all();assert(rows.every(r=>r.key.length===64&&!Object.values(r).includes('bad-guess')));
  const clean=makeEnv(),req=new Request(base,{headers:{'CF-Connecting-IP':'192.0.2.1'}}),first=await reserveCredentialCheck(req,clean,'owner'),second=await reserveCredentialCheck(req,clean,'owner');
  await finishCredentialCheck(clean,first,true);await finishCredentialCheck(clean,second,false);assert.equal(clean.sqlite.prepare('SELECT attempts FROM portal_login_limits WHERE key=?').get(second.key).attempts,2);
});

test('current-password verification shares the server guess limit and cannot bypass it through password change',async t=>{
  const env=makeEnv();await member(env);const session=await ok(login(env,'000071','0123')),before=env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000071'").get().password_hash;
  let stamp=Date.now();t.mock.method(Date,'now',()=>stamp);
  for(let i=0;i<5;i++)assert.equal((await request(env,'/api/auth/password','POST',{currentPassword:'9999',newPassword:'0000'},session.token)).status,403);
  assert.equal((await login(env,'000071','0123')).status,429);assert.equal((await request(env,'/api/auth/password','POST',{currentPassword:'0123',newPassword:'0000'},session.token)).status,429);
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='000071'").get().password_hash,before);
  stamp+=LOGIN_WINDOW_MS+1;await ok(request(env,'/api/auth/password','POST',{currentPassword:'0123',newPassword:'0000'},session.token));await ok(login(env,'000071','0000'));
});
