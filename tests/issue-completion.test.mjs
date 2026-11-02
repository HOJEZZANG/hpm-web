import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
import {validateIssueCompletionDate} from '../business/issue-completion.mjs';
import {analyzeIssues} from '../business/ui/issue-analytics.js';
const call=(env,id,body,token=TOKEN)=>worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues/'+id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}),env);
async function save(env,body){const r=await call(env,'completion',body),data=await r.json();assert.equal(r.status,200,data.error);return data.issue;}

test('completion calendar validation uses Korea today and exempts unchanged legacy values',()=>{
  for(const invalid of ['2026-02-30','2026-2-03','2026-10-31','2026-11-03','2026-11-02T00:00:00Z',null,42])assert.throws(()=>validateIssueCompletionDate(invalid,'2026-11-01',undefined,'2026-11-02'));
  assert.equal(validateIssueCompletionDate('2026-11-02','2026-11-01',undefined,'2026-11-02'),'2026-11-02');
  assert.equal(validateIssueCompletionDate('2026-02-30','2026-11-01','2026-02-30','2026-11-02'),'2026-02-30');
  assert.equal(validateIssueCompletionDate('','2026-11-01','2026-11-01'),'');
});

test('completion API reuses completed_date: edit, omitted preservation, explicit clear, reload and metrics',async()=>{
  const env=makeEnv(true);
  const initial=await save(env,{description:'합성 완료일',occurDate:'2020-01-01',status:'종결'});
  assert.equal(initial.completedDate,'');
  const updated=await save(env,{completedDate:'2020-01-05'});assert.equal(updated.status,'종결');assert.equal(updated.completedDate,'2020-01-05');
  assert.equal(env.sqlite.prepare('SELECT completed_date FROM issues').get().completed_date,'2020-01-05');
  assert.equal(JSON.parse(env.sqlite.prepare('SELECT payload FROM issues').get().payload).completedDate,'2020-01-05');
  assert.match(updated.history.at(-1).note,/실제 완료일/);
  const preserved=await save(env,{actionDetail:'일반 수정'});assert.equal(preserved.completedDate,'2020-01-05');
  const response=await worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues',{headers:{Authorization:'Bearer '+TOKEN}}),env),rows=(await response.json()).issues;
  assert.equal(rows[0].completedDate,'2020-01-05');assert.equal(analyzeIssues(rows,{},'2026-11-02').lead,4);
  const cleared=await save(env,{completedDate:''});assert.equal(cleared.completedDate,'');assert.equal(cleared.status,'종결');assert.equal(analyzeIssues([cleared],{},'2026-11-02').lead,null);
  assert.equal((await call(env,'completion',{completedDate:'2020-01-05'},'invalid')).status,401);
});

test('invalid new dates cannot write; legacy missing/invalid/future dates survive general edits',async()=>{
  const env=makeEnv();await save(env,{description:'합성',occurDate:'2020-01-01'});
  for(const completedDate of ['2019-12-31','9998-12-31','2020-02-30',null,5]){
    assert.equal((await call(env,'completion',{completedDate})).status,400);
    assert.equal(env.sqlite.prepare('SELECT completed_date FROM issues').get().completed_date,'');
  }
  for(const old of ['', '날짜 미정','2020-02-30','9998-12-31','2019-12-31']){
    env.sqlite.prepare('UPDATE issues SET completed_date=?').run(old);
    assert.equal((await save(env,{actionDetail:'다른 내용 '+old})).completedDate,old);
    assert.equal((await save(env,{completedDate:old})).completedDate,old);
  }
  const open=await save(env,{completedDate:'2020-01-02'});assert.equal(open.status,'접수');
  assert.equal((await save(env,{status:'조치완료'})).completedDate,'2020-01-02');
});
