import test from 'node:test';
import assert from 'node:assert/strict';
import {productionAdherence} from '../business/ui/production-adherence.js';
import {productionProcessState,ahuProcessState,productionView,ahuView} from '../business/ui/production-view.js';
import {productionDisplay} from '../business/ui/production-display.js';
import {parseProductionSheet,normalizeProductionRow} from '../business/production-sheet.mjs';
import {writeTable} from '../business/ooxml.mjs';
import {ahuBytes} from './support/production-parts-fixtures.mjs';
const today='2026-11-04';
function fixture(part){return [
 ['past-apr','2026-11-03','납품준비 [APR]',100],['today-complete',today,'완료',2],
 ['active','2026-11-02',part==='part2'?'조립2[HA2]':'조립',1],['blank',today,'',1],['unknown','2026-11-01','미확인 공정',1],
 ['future','2026-11-05','납품준비',999],['missing','','납품준비',1],['invalid','2026-02-30','완료',1],['spaced',' '+today+' ','APR',1]
 ].map(([id,PND,현공정,수량])=>({id,PND,현공정,수량,분류:'AC','LINE 5000':'AHU',Yard:id==='active'?'선택 B':'선택 A',HullNo:id,실제완료일:'2099-12-31',최종완료일:'잘못된 날짜'}));}
test('both parts count due rows, including today and unknown processes, while excluding future/invalid/missing PND',()=>{
 for(const part of ['part1','part2']){const records=fixture(part),before=JSON.stringify(records),m=productionAdherence(records,{part,today});
  assert.equal(m.eligible,6);assert.equal(m.completed.length,3);assert.equal(m.active.length,1);assert.equal(m.unknown.length,2);assert.equal(m.rate,50);
  assert.deepEqual(m.completed.map(r=>r.record.id),['past-apr','today-complete','spaced']);assert.deepEqual(m.future.map(r=>r.record.id),['future']);assert.equal(m.excluded.length,2);assert.equal(m.missingPnd,1);assert.equal(m.invalidPnd,1);
  assert.equal(m.due.length,m.eligible);assert.equal(m.due.length+m.future.length+m.excluded.length,records.length);assert.equal(JSON.stringify(records),before);
 }
});
test('zero denominator is unavailable as a percentage, while due unfinished/unknown rows yield zero percent',()=>{
 for(const part of ['part1','part2']){const records=fixture(part);for(const rows of [[],records.filter(r=>['future','missing','invalid'].includes(r.id))]){const m=productionAdherence(rows,{part,today});assert.equal(m.status,'empty');assert.equal(m.eligible,0);assert.equal(m.rate,null);}
  const m=productionAdherence(records.filter(r=>['active','blank','unknown'].includes(r.id)),{part,today});assert.equal(m.eligible,3);assert.equal(m.rate,0);assert.equal(m.unknown.length,2);
 }
});
test('actual completion fields are never read and quantity cannot change row-count adherence',()=>{
 const record={PND:today,현공정:'납품준비',수량:999999};for(const key of ['실제완료일','최종완료일','최신공정완료일'])Object.defineProperty(record,key,{get(){throw Error('Actual completion must not be an input');}});
 assert.equal(productionAdherence([Object.freeze(record),{PND:today,현공정:'조립',수량:1}],{part:'part1',today}).rate,50);
});
test('future completed rows remain in overall completion and charts exactly once, and identical original rows stay separate',()=>{
 for(const part of ['part1','part2']){
  const records=fixture(part),view=part==='part1'?productionView(records,{},'분류',{},today):ahuView(records,{}, {},today),shown=productionDisplay(view,part,'분류'),m=productionAdherence(view.records,{part,today});
  assert.equal(shown.summary.ready,6);assert.equal(shown.groups.reduce((n,g)=>n+g.ready,0),6);assert.equal(m.completed.length,3);assert.equal(m.future.filter(x=>x.state==='ready').length,1);assert.equal(new Set(m.due.map(x=>x.record.id)).size,m.eligible);
  const twins=[{id:'original-1',PND:today,현공정:'완료'},{id:'original-2',PND:today,현공정:'완료'}],two=productionAdherence(twins,{part,today});assert.equal(two.eligible,2);assert.equal(two.completed.length,2);
 }
});
test('default reference day crosses midnight in Korea independently of the browser timezone',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-03T15:00:00Z')});
 const m=productionAdherence([{PND:today,현공정:'완료'},{PND:'2026-11-05',현공정:'완료'}],{part:'part2'});assert.equal(m.today,today);assert.equal(m.eligible,1);assert.equal(m.future.length,1);assert.equal(m.rate,100);
});
test('both verified part mappings share explicit completion and preserve unknown and active process values',()=>{
 for(const fn of [productionProcessState,ahuProcessState]){
  for(const value of ['납품준비','납품준비 [APR]','납품준비 완료','납품준비 완료 [APR]','APR','완료','  완료  ','  납품준비 [apr]  ','납품준비 [ APR ]'])assert.equal(fn(value),'ready',value);
  for(const value of ['','미확인','납품준비 대기','UNKNOWN[APR]','납품준비 [AA1]','완료예정','조립완료','미완료','완 료','납 품준비'])assert.equal(fn(value),'unknown',value);
 }
 assert.equal(productionProcessState('PROV 결선[PEL]'),'active');for(const value of ['FRAME 도장[HFP]','냉매라인 보온작업[HIS]','결선AH [HEL]','조립3[HA3]','조립2[HA2]','BED FRAME 제작[HBE]'])assert.equal(ahuProcessState(value),'active');
});
test('part-specific original PND/current-process column mappings drive status without requiring final dates',()=>{
 const one=parseProductionSheet(writeTable(['PND','현공정','수량','분류'],[[today,'납품준비 [APR]',100,'AC'],[today,'완료',1,'AC'],[today,'조립',1,'AC'],[today,'',1,'AC']]),()=>{},'part1');
 const two=parseProductionSheet(ahuBytes(4,{rows:['납품준비 [APR]','완료','조립2[HA2]',''].map((p,i)=>['합성 야드','0000'+i,p,today,i+1,'ITEM','WO','AHU','HKA-08SN','',''])}),()=>{},'part2');
 for(const [part,parsed]of [['part1',one],['part2',two]]){for(const field of ['PND','현공정'])assert.equal(parsed.meta.columns.find(c=>c.id===parsed.meta.mapping[field]).title,field);const m=productionAdherence(parsed.rows.map(r=>normalizeProductionRow(r,parsed.meta)),{part,today});assert.equal(m.eligible,4);assert.equal(m.rate,50);assert.equal(m.unknown.length,1);}
});
test('documented 173-column AHU layout maps original F/H process/PND and preserves both completion labels',()=>{
 const headers=Array(173).fill('');for(const [position,title]of [[4,'Yard'],[5,'HullNo'],[6,'현공정'],[8,'PND'],[9,'수량'],[10,'품번'],[11,'Work Order'],[20,'LINE 5000'],[26,'규격'],[34,'최종완료일'],[35,'최신공정완료일']])headers[position-1]=title;
 const values=['납품준비 [APR]','완료','조립2[HA2]',''].map((process,i)=>{const r=Array(173).fill('');for(const [position,value]of [[4,'합성 야드'],[5,'000'+i],[6,process],[8,today],[9,1],[10,'ITEM'],[11,'WO'],[20,'AHU'],[26,'HKA-08SN']])r[position-1]=value;return r;});
 const plan=parseProductionSheet(writeTable(headers,values),()=>{},'part2');assert.equal(plan.meta.columns.find(c=>c.id===plan.meta.mapping['현공정']).position,6);assert.equal(plan.meta.columns.find(c=>c.id===plan.meta.mapping.PND).position,8);
 const records=plan.rows.map(r=>normalizeProductionRow(r,plan.meta)),m=productionAdherence(records,{part:'part2',today});assert.deepEqual(records.map(r=>r.현공정),['납품준비 [APR]','완료','조립2[HA2]','']);assert.equal(m.completed.length,2);assert.equal(m.rate,50);
});
test('search, part-specific filters and selections keep summary, chart, detail and adherence on identical rows',()=>{
 for(const part of ['part1','part2'])for(const filters of [{},{q:'past-apr'},{Yard:'선택 B'},{from:today,to:today}])for(const selection of [{},{status:'ready'},{status:'unknown'},{risk:'overdue'}]){
  const rows=fixture(part),v=part==='part1'?productionView(rows,filters,'분류',selection,today):ahuView(rows,filters,selection,today),d=productionDisplay(v,part,'분류'),m=productionAdherence(v.records,{part,today:v.today});
  assert.equal(d.summary.total,v.records.length);assert.equal(d.groups.reduce((n,g)=>n+g.ready,0),d.summary.ready);assert.equal(m.completed.length,v.records.filter(r=>r.PND.trim()&&r.PND.trim()<=today&&['ready'].includes((part==='part2'?ahuProcessState:productionProcessState)(r.현공정))&&/^2026-11-/.test(r.PND.trim())).length);
  assert.equal(m.eligible,m.completed.length+m.active.length+m.unknown.length);
 }
});
