import test from 'node:test';import assert from 'node:assert/strict';
import {calendarDate} from '../business/ahu-pnd.mjs';
import {compareProductionPnd,filterPndResults,pndExportRows,pndExportColumns} from '../business/ui/pnd-comparison.js';
import {analyzeIssues,day} from '../business/ui/issue-analytics.js';
const row=(date,side='plan',overrides={})=>({yard:'SHI',hull:'00001',spec:side==='plan'?'HKA-08SN':'HKA008SN/ORDER',pnd:date,date:calendarDate(date),row:3,file:side+'.xlsx',sheet:'Sheet1',...overrides});
const compare=(erp,plan,options={})=>compareProductionPnd({part:'part2',erp:[row(erp,'erp')],plan:[row(plan)],...options});
test('latest ERP minus plan baseline: requested cases, sort/filter, and exported cells agree',()=>{
 for(const [erp,plan,diff,status,label]of [['2026-11-15','2026-11-20',-5,'advanced','5일 당겨짐'],['2026-11-25','2026-11-20',5,'delayed','5일 지연'],['2026-11-20','2026-11-20',0,'same','변경 없음'],['2027-01-01','2026-12-31',1,'delayed','1일 지연'],['2026-02-28','2026-03-01',-1,'advanced','1일 당겨짐'],['2028-03-01','2028-02-28',2,'delayed','2일 지연']]){
  const rows=compare(erp,plan),r=rows[0];assert.equal(r.diff,diff);assert.equal(r.status,status);assert.equal(r.label,label);const exported=pndExportRows(rows)[0];assert.equal(exported[pndExportColumns.indexOf('생산계획 PND')],plan);assert.equal(exported[pndExportColumns.indexOf('ERP 최신 PND')],erp);assert.equal(exported[pndExportColumns.indexOf('변경 내용')],label);assert.equal(exported[pndExportColumns.indexOf('변경 일수 (ERP-생산계획)')],diff);assert.equal(filterPndResults(rows).length,status==='same'?0:1);assert.equal(filterPndResults(rows,'',status).length,1);
 }
});
test('invalid/blank dates, ambiguous links and differing yards never become unchanged or confirmed changes',()=>{
 for(const value of ['',null,'2026-02-30','11/20/26']){const [r]=compare(value,'2026-11-20');assert.equal(r.status,'review');assert.equal(r.label,'날짜 확인 필요');assert.equal(r.diff,null);}
 const duplicates=compareProductionPnd({erp:[row('2026-11-15','erp'),row('2026-11-15','erp',{row:4})],plan:[row('2026-11-20')]});assert(duplicates.every(r=>r.status==='review'&&!r.linked&&r.diff===null));
 const e=row('2026-11-15','erp',{yard:'ERP 표기'}),p=row('2026-11-20','plan',{yard:'계획 표기'});assert.equal(compareProductionPnd({erp:[e],plan:[p]})[0].label,'연결 확인 필요');assert.equal(compareProductionPnd({erp:[e],plan:[p],aliases:{'계획 표기':'ERP 표기'}})[0].diff,-5);
 assert.throws(()=>compareProductionPnd({part:'part1',erp:[],plan:[]}),/검증 대기/);
 assert.equal(calendarDate(1,true).iso,'1904-01-02');assert.equal(calendarDate(61).iso,'1900-03-01');assert.equal(calendarDate(60).iso,'');
});
test('dashboard metrics share filters, documented closed states and valid actual completion dates',()=>{
 const records=[{id:'a',product:'AHU',status:'종결',occurDate:'2026-10-25',completedDate:'2026-10-30',followupFlag:true,prevention:'실제 기록'},{id:'b',product:'AHU',status:'조치완료',occurDate:'2026-10-26',completedDate:''},{id:'c',product:'CHILLER',status:'접수',occurDate:'2026-11-01',completedDate:'2026-11-01',processPnd:'2026-10-31'},{id:'d',product:'AHU',status:'접수',occurDate:'',completedDate:''}];
 const all=analyzeIssues(records,{},'2026-11-01');assert.equal(all.total,4);assert.equal(all.closeRate,50);assert.equal(all.lead,5);assert.equal(all.leadCount,1);assert.equal(all.leadExcluded,1);assert.equal(all.followups,1);assert.equal(all.reviews.length,1);assert.equal(all.overdue,1);assert.equal(all.missingOccur,1);assert.equal(Object.values(all.groups.product).reduce((a,b)=>a+b,0),4);
 const shown=analyzeIssues(records,{start:'2026-10-25',end:'2026-11-01',product:'AHU'},'2026-11-01');assert.equal(shown.total,2);assert.equal(shown.closeRate,100);assert.deepEqual(shown.items.map(r=>r.id),['a','b']);assert.equal(shown.trend['2026-10'],2);
 assert.equal(analyzeIssues([],{},'2026-11-01').closeRate,null);assert.equal(analyzeIssues([{status:'종결',occurDate:'2026-11-01',completedDate:'2026-10-31'}],{},'2026-11-01').lead,null);assert.equal(day('2026-02-30'),null);assert.throws(()=>analyzeIssues(records,{start:'2026-12-01',end:'2026-11-01'}),/종료일/);
});
