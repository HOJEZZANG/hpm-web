import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {productionPriority,createProductionPriority} from '../business/ui/production-priority.js';
import {productionAdherence} from '../business/ui/production-adherence.js';
import {productionView,ahuView} from '../business/ui/production-view.js';
import {classifyProductionLinks} from '../business/production-related.mjs';
import {productionSourceDate} from '../business/production-source-date.mjs';
import {koreanToday} from '../business/domain.mjs';
const today='2026-11-23';
function fixture(part){const active=part==='part2'?'조립2[HA2]':'조립';return [['old','2026-11-01',active],['yesterday','2026-11-22',active],['today',today,active],['thirteen','2026-12-06',active],['fourteen','2026-12-07',active],['ready','2026-11-01','완료'],['empty','2026-11-01',''],['unclassified',today,'새로운 공정'],['missing','',active],['invalid','2026-02-30',active]].map(([id,PND,process],i)=>({id,PND,'현공정':process,Yard:'STX',HullNo:'0001','규격':'HKA-13/12','수량':i+1,'분류':'AC','LINE 5000':'AHU'}));}
test('both parts use fourteen KST calendar days, only explicit active processes, oldest-first order, and separate uncertain dates',()=>{
 for(const part of ['part1','part2']){const rows=fixture(part),m=productionPriority(rows,{part,today});assert.deepEqual(m.overdue.map(i=>i.record.id),['old','yesterday']);assert.deepEqual(m.upcoming.map(i=>i.record.id),['today','thirteen']);assert.deepEqual(m.unknown.map(i=>i.record.id),['empty','unclassified']);assert.deepEqual(m.dates.map(i=>i.record.id),['missing','invalid']);assert.equal(m.unknown[0].reasons[0],'공정 미기재');assert.equal(m.dates[1].days,null);assert(![...m.overdue,...m.upcoming].some(i=>i.state!=='active'));}
 assert.equal(koreanToday(new Date('2026-11-22T14:59:59Z')),'2026-11-22');assert.equal(koreanToday(new Date('2026-11-22T15:00:00Z')),'2026-11-23');
});
test('cards and every paged list use the same filtered model, with counts distinct from quantities',()=>{
 const {document}=parseHTML('<main><section data-production-priority></section></main>'),root=document.querySelector('main'),panel=createProductionPriority(root,'part1');
 assert(root.textContent.includes('조회 전'));assert.equal(root.querySelector('[data-priority-count]'),null);
 const rows=[...fixture('part1'),{...fixture('part1')[0],id:'other',Yard:'HHI'}],filtered=productionView(rows,{Yard:'STX'},'분류',{},today).records;panel.update(filtered,{today});
 assert.equal(root.querySelector('[data-priority-count=overdue]').textContent,'2건');assert(root.textContent.includes('수량 3'));assert.equal(root.querySelectorAll('[data-priority-list] tbody tr').length,2);
 root.querySelector('[data-priority-list]').focus=()=>{};root.querySelector('[data-priority-list]').scrollIntoView=()=>{};
 // Linkedom does not implement layout/focus. Bucket behavior is covered in the actual browser check.
 panel.restore({selected:'upcoming'});
 assert.equal(root.querySelector('[data-priority-list-count]').textContent,'2건');assert.equal(root.querySelectorAll('[data-priority-list] tbody tr').length,2);
});
test('current completion denominator and numerator are unchanged, including unknown process only in denominator',()=>{
 for(const part of ['part1','part2']){const rows=fixture(part),m=productionAdherence(rows,{part,today});assert.equal(m.completed.length,1);assert.equal(m.eligible,6);assert.equal(m.unknown.length,2);assert(Math.abs(m.rate-100/6)<1e-10);assert.equal(m.future.length,2);assert.equal(m.excluded.length,2);}
});
test('priority pagination preserves the full card count and does not drop or duplicate the second page',()=>{
 const {document}=parseHTML('<main><section data-production-priority></section></main>'),root=document.querySelector('main'),panel=createProductionPriority(root,'part1');const rows=Array.from({length:70},(_,i)=>({...fixture('part1')[0],id:String(i),HullNo:String(i).padStart(4,'0')}));panel.update(rows,{today});assert.equal(root.querySelector('[data-priority-count=overdue]').textContent,'70건');assert.equal(root.querySelectorAll('[data-priority-list] tbody tr').length,50);root.querySelector('[data-priority-page="1"]').dispatchEvent(new document.defaultView.Event('click',{bubbles:true}));assert.equal(root.querySelectorAll('[data-priority-list] tbody tr').length,20);assert(root.textContent.includes('51~70 / 70건'));assert.equal(root.querySelector('[data-priority-count=overdue]').textContent,'70건');
});
test('related records require verified yard/hull/product for a unique match; hull-only and duplicate candidates stay review-only',()=>{
 const row=fixture('part2')[0],record={hull:'0001',yard:'KSB',spec:'HKA-13/12'};
 assert.equal(classifyProductionLinks(row,[record]).confirmed,true);assert.equal(classifyProductionLinks(row,[{hull:'0001'}]).confirmed,false);assert.equal(classifyProductionLinks(row,[record,record]).confirmed,false);assert.equal(classifyProductionLinks(row,[{...record,hull:'1'}]).records.length,0);assert.equal(classifyProductionLinks(row,[{project:'STX 0001',product:'HKA-13/12'}]).confirmed,false);
});
test('source basis date requires an explicit source label and does not substitute upload dates or filenames',()=>{
 assert.equal(productionSourceDate([{number:1,values:['기준일: 2026-11-20']}]),'2026-11-20');assert.equal(productionSourceDate([{number:1,values:['자료 기준일','2026-11-21']}]),'2026-11-21');assert.equal(productionSourceDate([{number:1,values:['생산현황_20261123.xlsx','2026-11-23']}]),'');assert.equal(productionSourceDate([{number:1,values:['기준일','2026-11-21','기준일','2026-11-20']}]),'');
});
