import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeIssues,issueCardEvidence} from '../business/ui/issue-analytics.js';
const today='2026-11-01',records=[
 {id:'done',status:'종결',occurDate:'2026-10-20',completedDate:'2026-10-25',product:'AHU',process:'조립',responsibleDept:'QM팀',followupFlag:true,prevention:'저장 내용'},
 {id:'same-day',status:'조치완료',occurDate:today,completedDate:today,product:'AHU'},
 {id:'blank',status:'종결',occurDate:'2026-10-20',completedDate:'',product:'AHU'},
 {id:'bad',status:'종결',occurDate:'2026-02-30',completedDate:'2026-10-25',product:'AHU'},
 {id:'reverse',status:'종결',occurDate:'2026-10-25',completedDate:'2026-10-24',product:'AHU'},
 {id:'future',status:'조치완료',occurDate:'2026-10-20',completedDate:'2026-11-02',product:'AHU'},
 {id:'overdue',status:'접수',occurDate:today,processPnd:'2026-10-31',product:'AHU'},
 {id:'due-today',status:'원인검토중',occurDate:today,processPnd:today,product:'CHILLER'},
 {id:'not-done',status:'조치중',occurDate:today,completedDate:today,processPnd:'날짜 미정',product:'AHU',prevention:'체크 없음'}];
test('six summary cards expose exactly their counted records under the same filters',()=>{
 const data=analyzeIssues(records,{},today),ids=card=>issueCardEvidence(data,card).rows.map(r=>r.record.id);
 assert.equal(ids('total').length,data.total);assert.equal(ids('open').length,data.open);assert.equal(ids('overdue').length,data.overdue);assert.deepEqual(ids('overdue'),['overdue']);assert(!ids('overdue').includes('due-today'));
 assert.equal(ids('completion').length,data.completed);assert.equal(issueCardEvidence(data,'completion','all').rows.length,data.total);assert.equal(ids('followup').length,data.followups);assert.deepEqual(ids('followup'),['done']);
 const filtered=analyzeIssues(records,{product:'AHU',process:'조립',responsibleDept:'QM팀',start:'2026-10-20',end:'2026-10-20'},today);for(const card of ['total','completion','lead','followup'])assert.equal(issueCardEvidence(filtered,card).rows.length,1);
});
test('lead evidence reproduces the average, includes same-day zero, and explains each completed exclusion',()=>{
 const data=analyzeIssues(records,{},today),included=issueCardEvidence(data,'lead').rows,excluded=issueCardEvidence(data,'lead','excluded').rows;
 assert.deepEqual(included.map(r=>r.days),[5,0]);assert.equal(data.lead,2.5);assert.equal(included.length,data.leadCount);assert.equal(excluded.length,data.leadExcluded);assert.equal(excluded.length,4);
 for(const [id,reason]of [['blank','누락'],['bad','오류'],['reverse','이전'],['future','오늘 이후']])assert(excluded.find(r=>r.record.id===id).reasons.some(r=>r.includes(reason)));
 assert.equal(issueCardEvidence(data,'lead','open').rows.length,data.open);assert(!included.some(r=>r.record.id==='not-done'));
});
test('zero and invalid date results remain explicit rather than estimated metrics',()=>{
 const data=analyzeIssues(records,{product:'NAVY'},today);assert.equal(data.closeRate,null);assert.equal(data.lead,null);for(const card of ['total','open','overdue','completion','lead','followup'])assert.equal(issueCardEvidence(data,card).rows.length,0);
 assert.equal(analyzeIssues([{...records[0],completedDate:''}],{},today).lead,null);
});
