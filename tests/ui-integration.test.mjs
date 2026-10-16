import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev';
const request=(env,path,method='GET',body,token=TOKEN,headers={})=>worker.fetch(new Request(base+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
async function ok(response){const r=await response,b=await r.json();assert.equal(r.status,200,b.error);return b;}
test('server-only management numbers and authors: minimal input, unique draft, no draft rows, idempotent retry',async()=>{
  const env=makeEnv(),[a,b]=await Promise.all([ok(request(env,'/api/issues/draft')),ok(request(env,'/api/issues/draft'))]);
  assert.notEqual(a.id,b.id);assert.notEqual(a.issueNo,b.issueNo);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM issues').get().n,0);
  const input={description:'합성 최소 상세내용',actionDetail:'조치를 적어도 완료로 바뀌지 않음',reporter:'위조 작성자',reporterId:'somebody',issueNo:'위조 번호'};
  const saved=(await ok(request(env,'/api/issues/'+a.id,'PUT',input))).issue;assert.equal(saved.issueNo,a.issueNo);assert.equal(saved.reporterId,'owner');assert.equal(saved.reporter,'등록자');assert.equal(saved.title,input.description);assert.equal(saved.status,'접수');assert.equal(saved.processPnd,'');assert.equal(saved.process,'');assert.equal(saved.feedbackOwner,'');assert.equal(saved.deliveryDate,'');assert.equal(saved.completedDate,'');assert.equal(saved.registerDate,'');
  const retry=(await ok(request(env,'/api/issues/'+a.id,'PUT',{...input,issueNo:'다른 번호'}))).issue;assert.equal(retry.issueNo,a.issueNo);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM issues').get().n,1);
  assert.equal((await request(env,'/api/issues/bad','PUT',{description:'날짜 검증',occurDate:'2026-02-30'})).status,400);
  env.sqlite.prepare('UPDATE issues SET issue_no=? WHERE id=?').run('HPM-collision',a.id);assert.equal((await request(env,'/api/issues/collision','PUT',{description:'충돌 검증'})).status,409);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM issues').get().n,1);
});
test('partial issue edits preserve hidden legacy columns, owner, unknown dates, original photos and history',async()=>{
  const env=makeEnv();await ok(request(env,'/api/issues/legacy','PUT',{title:'합성 기존 제목',description:'합성 기존 내용',process:'조립1',processPnd:'2026-10-20',feedbackOwner:'합성 담당',causeFeedback:'합성 원인',prevention:'합성 예방',yard:'합성 YARD',part:'미정',history:[{at:'2026-01-01',actor:'합성 작성자',status:'접수',note:'기존 이력'}]}));
  const inline='data:image/png;base64,iVBORw==';env.sqlite.prepare('UPDATE issues SET register_date=?,process_pnd=?,reporter_id=?,reporter=?,images=? WHERE id=?').run('','기존 미지정 PND','','기존 표시 이름',JSON.stringify([inline]),'legacy');
  const before={...env.sqlite.prepare("SELECT * FROM issues WHERE id='legacy'").get()};
  await ok(request(env,'/api/issues/legacy','PUT',{description:'합성 수정 내용',reporter:'탈취',reporterId:'owner',issueNo:'탈취'}));const after={...env.sqlite.prepare("SELECT * FROM issues WHERE id='legacy'").get()};
  for(const key of Object.keys(before))if(!['description','updated_at'].includes(key))assert.equal(after[key],before[key],key+' should survive partial update');
  assert.equal(env.objects.size,0,'Existing inline photo was not automatically moved');
});
test('legacy payload extensions survive partial updates',async()=>{
  const env=makeEnv(true);await ok(request(env,'/api/issues/payload','PUT',{description:'합성 payload'}));
  const before=JSON.parse(env.sqlite.prepare("SELECT payload FROM issues WHERE id='payload'").get().payload);before.legacyExtension={untouched:'합성 확장 항목'};env.sqlite.prepare("UPDATE issues SET payload=? WHERE id='payload'").run(JSON.stringify(before));
  await ok(request(env,'/api/issues/payload','PUT',{description:'합성 payload 수정'}));const after=JSON.parse(env.sqlite.prepare("SELECT payload FROM issues WHERE id='payload'").get().payload);assert.deepEqual(after.legacyExtension,before.legacyExtension);assert.equal(after.description,'합성 payload 수정');
});
test('pending, rejection/disabled, invalid credentials, expiration and forbidden access have distinct server codes',async()=>{
  const env=makeEnv(),user={id:'test-user',name:'합성 사용자',password:'synthetic-ui-password'};await ok(request(env,'/api/auth/register','POST',user,null));
  let r=await request(env,'/api/auth/login','POST',user,null);assert.equal(r.status,403);assert.equal((await r.json()).code,'ACCOUNT_PENDING');
  r=await request(env,'/api/auth/login','POST',{...user,password:'synthetic-wrong-password'},null);assert.equal(r.status,401);assert.equal((await r.json()).code,'INVALID_CREDENTIALS');
  await ok(request(env,'/api/auth/users/'+user.id,'PUT',{status:'disabled'}));r=await request(env,'/api/auth/login','POST',user,null);assert.equal((await r.json()).code,'ACCOUNT_DISABLED');
  await ok(request(env,'/api/auth/users/'+user.id,'PUT',{status:'active'}));const login=await ok(request(env,'/api/auth/login','POST',user,null));
  r=await request(env,'/api/auth/users','GET',undefined,login.token);assert.equal(r.status,403);assert.equal((await r.json()).code,'FORBIDDEN');
  env.sqlite.prepare('UPDATE portal_sessions SET expires_at=? WHERE token_hash=?').run('2000-01-01T00:00:00Z',createHash('sha256').update(login.token).digest('hex'));r=await request(env,'/api/auth/me','GET',undefined,login.token);assert.equal((await r.json()).code,'SESSION_EXPIRED');
  const valid=await ok(request(env,'/api/auth/login','POST',user,null));await ok(request(env,'/api/auth/logout','POST',undefined,valid.token));assert.equal((await request(env,'/api/auth/me','GET',undefined,valid.token)).status,401);
});
test('old browser flags and forged role headers cannot access records, files or approvals',async()=>{
  const env=makeEnv();for(const path of ['/api/issues','/api/issues/draft','/api/as-events','/api/team-events','/api/auth/users','/api/business/weekly','/api/photos/issues/x/before/x.png']){
    const r=await request(env,path,'GET',undefined,null,{'X-User-Id':'owner','X-Role':'admin',Cookie:'productionPortalSessionV1=owner;loggedIn=true'});assert.equal(r.status,401,path);assert.equal((await r.json()).code,'AUTH_REQUIRED');
  }
});
test('removed vehicle/safety screens never appear in integration search while their retained records remain readable',async()=>{
  const env=makeEnv();env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));
  for(const [table,id,data] of [['vehicles','kept-car',{number:'합성 숨김 차량'}],['safety_checks','kept-safety',{factory:'합성 숨김 안전'}]])env.sqlite.prepare(`INSERT INTO ${table}(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(id,'owner',JSON.stringify(data),'2026-01-01','2026-01-01','2026-01-01');
  const result=await ok(request(env,'/api/business/search?q='+encodeURIComponent('합성 숨김')));assert.deepEqual(result.records,[]);
  assert.equal((await ok(request(env,'/api/business/vehicles'))).records.length,1);assert.equal((await ok(request(env,'/api/business/safety'))).records.length,1);
});
