import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeIssueStatus,isCompletedIssueStatus,issueStatuses} from '../business/issue-status.mjs';
import {analyzeIssues} from '../business/ui/issue-analytics.js';import {issueChanges} from '../business/issue-history.mjs';
import worker from '../worker.js';import {makeEnv,TOKEN} from './support/env.mjs';import {createPresentation} from '../business/ui/presentation.js';
const put=(env,id,body)=>worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues/'+id,{method:'PUT',headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
test('exact completion aliases normalize without partial matches or date inference',()=>{
 assert.deepEqual(issueStatuses,['접수','원인검토중','조치중','조치완료']);for(const v of ['종결','조치 완료','조치완료']){assert.equal(normalizeIssueStatus(v),'조치완료');assert(isCompletedIssueStatus(v));}
 for(const v of ['접수','원인검토중','조치중','미종결','조치완료 예정'])assert(!isCompletedIssueStatus(v));
 const records=[{status:'종결',occurDate:'2026-11-01',completedDate:'2026-11-03'},{status:'조치완료',occurDate:'2026-11-02',completedDate:''},{status:'접수',occurDate:'2026-11-01'}],before=analyzeIssues(records,{},'2026-11-18'),after=analyzeIssues(records.map(r=>({...r,status:normalizeIssueStatus(r.status)})),{},'2026-11-18');
 for(const key of ['total','completed','open','closeRate','lead','leadCount','leadExcluded'])assert.equal(after[key],before[key]);assert.deepEqual(after.groups.status,{조치완료:2,접수:1});assert.deepEqual(before.groups.status,after.groups.status);
 assert.deepEqual(issueChanges({status:'종결'},{status:'조치완료'}),[]);assert.deepEqual(issueChanges({status:'조치 완료'},{status:'조치완료'}),[]);
});
test('legacy API writes/reads are canonical; actual dates, photos and existing history are preserved',async()=>{
 const env=makeEnv();try{
 const originalHistory=[{at:'2020-01-01',status:'종결',actor:'과거 작성자',note:'과거 원문 종결'}];
 const first=await put(env,'legacy-status',{description:'합성 완료 기록',status:'종결',occurDate:'2020-01-01',completedDate:'2020-01-03',history:originalHistory});assert.equal(first.status,200);const a=(await first.json()).issue;assert.equal(a.status,'조치완료');assert.equal(a.completedDate,'2020-01-03');
 env.sqlite.prepare("UPDATE issues SET status='종결',history=? WHERE id='legacy-status'").run(JSON.stringify(originalHistory));
 const read=await worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues',{headers:{Authorization:'Bearer '+TOKEN}}),env);const b=(await read.json()).issues.find(r=>r.id==='legacy-status');assert.equal(b.status,'조치완료');assert.deepEqual(b.history,originalHistory);
 const second=await put(env,'legacy-status',{status:'조치 완료'});assert.equal(second.status,200);const c=(await second.json()).issue;assert.equal(c.status,'조치완료');assert.equal(c.completedDate,'2020-01-03');assert.equal(c.occurDate,'2020-01-01');assert.equal(c.reporterId,a.reporterId);assert.deepEqual(c.images,a.images);assert.deepEqual(c.history,originalHistory);
 const missing=(await(await put(env,'without-date',{description:'완료일 미등록',status:'조치 완료'})).json()).issue;assert.equal(missing.completedDate,'');assert.equal(missing.status,'조치완료');
 const report=createPresentation([{...b,status:'종결',history:originalHistory}],[],[]);assert(report.includes('조치완료'));assert(!report.includes('>종결<'));assert(report.includes('과거 원문 종결'));
 }finally{env.sqlite.close();}
});
