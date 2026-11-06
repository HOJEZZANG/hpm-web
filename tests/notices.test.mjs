import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev';
const request=(env,path,method='GET',body,token=TOKEN)=>worker.fetch(new Request(base+'/api/business/notices'+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
async function ok(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
function account(env,id,role='admin'){
 const token=createHash('sha256').update('synthetic-'+id).digest('hex');env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'이름 '+id,'unused','unused',role,'active',new Date().toISOString());
 env.sqlite.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00Z');return token;
}
const history=async(env,id,token=TOKEN)=>(await ok(await request(env,'/'+id+'/history','GET',undefined,token))).records;
const saved=(env,id)=>env.sqlite.prepare('SELECT * FROM notices WHERE id=?').get(id);
test('authenticated creator, editor and server time ignore forged identity; only names reach notice readers',async()=>{
 const env=makeEnv(),other=account(env,'editor'),viewer=account(env,'reader','user'),before=Date.now();
 let r=await ok(await request(env,'/n','PUT',{title:'제목',content:'내용',owner:'forged',authorName:'위조',noticeMeta:{author:{id:'forged',name:'위조'}},updatedAt:'1999-01-01',mutationId:'create'}));
 assert.equal(r.record.authorName,'등록자');assert.equal(saved(env,'n').owner,'owner');assert.equal(r.record.owner,undefined);assert.equal(r.record.authorId,undefined);assert.equal((await history(env,'n')).length,0);
 r=await ok(await request(env,'/n','PUT',{title:'다른 제목',content:'다른 내용',revision:1,mutationId:'edit',authorName:'편집자',history:[{bad:true}],editorId:'forged',at:'1999-01-01'},other));
 assert.equal(r.record.authorName,'등록자');assert.equal(r.record.lastEditorName,'이름 editor');assert.equal(saved(env,'n').owner,'owner');
 const meta=JSON.parse(saved(env,'n').data).noticeMeta;assert.equal(meta.author.name,'등록자');assert.equal(meta.lastEditor.id,'editor');
 const [entry]=await history(env,'n',viewer);assert.equal(entry.editorName,'이름 editor');assert(Date.parse(entry.at)>=before);assert(Date.parse(entry.at)<=Date.now());assert.equal(entry.actorId,undefined);assert.deepEqual(entry.changes,[{field:'title',label:'제목',before:'제목',after:'다른 제목'},{field:'content',label:'내용',before:'내용',after:'다른 내용'}]);
 const audit=env.sqlite.prepare("SELECT * FROM portal_audit WHERE json_extract(details,'$.noticeKind')='updated'").get();assert.equal(audit.actor_id,'editor');assert.equal(audit.actor_name,'이름 editor');assert.equal(audit.at,meta.lastEditor.at);
 env.sqlite.prepare("UPDATE portal_accounts SET name='변경된 이름' WHERE id IN ('owner','editor')").run();
 assert.equal((await ok(await request(env,'','GET',undefined,viewer))).records[0].authorName,'등록자');assert.equal((await history(env,'n'))[0].editorName,'이름 editor');
 assert.equal(env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n,2);
});
test('legacy owner lookup is reused; missing owners stay unrecorded after another user edits; old audit is not invented history',async()=>{
 const env=makeEnv(),other=account(env,'editor');
 for(const [id,owner]of [['known','owner'],['unknown','missing-owner']])env.sqlite.prepare('INSERT INTO notices(id,owner,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,owner,JSON.stringify({title:'기존 제목',content:'기존 내용  ',legacyExtra:'보존'}),'2020-01-01','2020-01-01');
 env.sqlite.prepare('INSERT INTO portal_audit(actor_id,actor_name,action,target_id,details,at) VALUES(?,?,?,?,?,?)').run('editor','과거 이름','PUT /api/business/notices/unknown','/api/business/notices/unknown','{}','2020-01-02');
 const before=saved(env,'unknown');const list=(await ok(await request(env,''))).records;assert.equal(list.find(r=>r.id==='known').authorName,'등록자');assert.equal(list.find(r=>r.id==='unknown').authorName,'미기록');assert.deepEqual(await history(env,'unknown'),[]);assert.deepEqual(saved(env,'unknown'),before);
 await ok(await request(env,'/unknown','PUT',{title:'수정 제목',content:'기존 내용  ',revision:1},other));const raw=JSON.parse(saved(env,'unknown').data);assert.equal(raw.content,'기존 내용  ');assert.equal(raw.legacyExtra,'보존');assert.equal(raw.noticeMeta.author.name,'');assert.equal((await ok(await request(env,''))).records.find(r=>r.id==='unknown').authorName,'미기록');
 assert.deepEqual((await history(env,'unknown'))[0].changes.map(c=>c.field),['title']);
});
test('unchanged saves and reads do not change timestamps, revisions or edit history',async()=>{
 const env=makeEnv();await ok(await request(env,'/n','PUT',{title:'제목',content:'내용'}));const before=saved(env,'n'),count=env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n;
 const r=await ok(await request(env,'/n','PUT',{title:'제목',content:'내용',revision:1,mutationId:'noop'}));assert(r.unchanged);await history(env,'n');await ok(await request(env,''));assert.deepEqual(saved(env,'n'),before);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM portal_audit').get().n,count);
});
test('save and history roll back together; failed response retries and repeated creates cannot duplicate history',async()=>{
 const env=makeEnv(),create={title:'제목',content:'원문',mutationId:'create'};await ok(await request(env,'/n','PUT',create));assert((await ok(await request(env,'/n','PUT',create))).replayed);
 const old=saved(env,'n');env.sqlite.exec("CREATE TRIGGER fail_notice_history BEFORE INSERT ON portal_audit WHEN json_extract(NEW.details,'$.noticeKind')='updated' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END;");
 const edit={title:'새 제목',content:'새 내용',revision:1,mutationId:'edit'};await ok(await request(env,'/n','PUT',edit),500);assert.deepEqual(saved(env,'n'),old);assert.equal((await history(env,'n')).length,0);
 env.sqlite.exec('DROP TRIGGER fail_notice_history');await ok(await request(env,'/n','PUT',edit));assert((await ok(await request(env,'/n','PUT',edit))).replayed);assert.equal((await history(env,'n')).length,1);
 await ok(await request(env,'/n','PUT',{...edit,content:'같은 ID 다른 요청'}),409);assert.equal(saved(env,'n').revision,2);
 const legacy={title:'세 번째',content:'새 내용',revision:2};await ok(await request(env,'/n','PUT',legacy));assert((await ok(await request(env,'/n','PUT',legacy))).replayed);assert.equal((await history(env,'n')).length,2);
});
test('serial D1 compare-and-swap deduplicates concurrent retries and rejects conflicting edits',async()=>{
 const env=makeEnv(),batch=env.DB.batch.bind(env.DB);let tail=Promise.resolve();env.DB.batch=statements=>{const next=tail.then(()=>batch(statements));tail=next.catch(()=>{});return next;};
 await ok(await request(env,'/n','PUT',{title:'제목',content:'내용'}));const edit={title:'수정',content:'내용',revision:1,mutationId:'same-edit'};
 const results=await Promise.all([request(env,'/n','PUT',edit),request(env,'/n','PUT',edit)]);for(const r of results)await ok(r);assert.equal((await history(env,'n')).length,1);
 const different=await Promise.all([request(env,'/n','PUT',{title:'A',content:'내용',revision:2,mutationId:'edit-a'}),request(env,'/n','PUT',{title:'B',content:'내용',revision:2,mutationId:'edit-b'})]);assert.deepEqual(different.map(r=>r.status).sort(),[200,409]);assert.equal((await history(env,'n')).length,2);
});
test('history is read-only and uses existing authenticated read/admin write permissions',async()=>{
 const env=makeEnv(),viewer=account(env,'viewer','user');await ok(await request(env,'/n','PUT',{title:'제목',content:'내용'}));
 for(const path of ['', '/n/history'])assert.equal((await request(env,path,'GET',undefined,null)).status,401);
 assert.equal((await request(env,'/n','PUT',{title:'위조',content:'위조',revision:1},viewer)).status,403);await ok(await request(env,'','GET',undefined,viewer));await ok(await request(env,'/n/history','GET',undefined,viewer));
 for(const method of ['POST','PUT','DELETE'])assert.equal((await request(env,'/n/history',method,{},viewer)).status,405);assert.equal((await request(env,'/n','DELETE',{})).status,405);assert.equal((await request(env,'/missing/history')).status,404);
 env.sqlite.prepare("UPDATE portal_accounts SET status='disabled' WHERE id='viewer'").run();assert.equal((await request(env,'/n/history','GET',undefined,viewer)).status,403);
});
test('continuous edits page newest first and retain exact escaped-text inputs, editor snapshots and before/after chains',async()=>{
 const env=makeEnv(),other=account(env,'second');await ok(await request(env,'/n','PUT',{title:'제목',content:'원문'}));let before='원문';
 for(let i=1;i<=55;i++){const after=`<script>${i}</script>\n& 원문`;await ok(await request(env,'/n','PUT',{title:'제목',content:after,revision:i,mutationId:'edit-'+i},i%2?other:TOKEN));before=after;}
 const first=await ok(await request(env,'/n/history'));assert.equal(first.records.length,50);assert.equal(first.records[0].revision,56);assert.equal(first.records[0].changes[0].after,before);assert.equal(first.records[0].editorName,'이름 second');const rest=await ok(await request(env,'/n/history?before='+first.nextBefore));assert.equal(rest.records.length,5);assert.equal(rest.nextBefore,null);assert.equal(rest.records.at(-1).changes[0].before,'원문');assert.equal(new Set([...first.records,...rest.records].map(r=>r.id)).size,55);
});
