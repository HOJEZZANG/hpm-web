import test from 'node:test';import assert from 'node:assert/strict';
import {productionAdherence} from '../business/ui/production-adherence.js';
import {parseProductionSheet,normalizeProductionRow} from '../business/production-sheet.mjs';
import {writeTable} from '../business/ooxml.mjs';
import {ahuBytes} from './support/production-parts-fixtures.mjs';
function fixture(part){const completion=part==='part2'?'최종완료일':'실제완료일',state=part==='part2'?'완료':'납품준비 [APR]',meta={part,date1904:false,columns:[{id:'c1',position:1,title:'PND'},{id:'c2',position:2,title:completion}],mapping:{PND:'c1',[completion]:'c2'}};
 const records=[{id:'same',PND:'2026-11-20',[completion]:'2026-11-20',현공정:state,수량:100},{id:'early',PND:'2026-11-20',[completion]:'2026-11-19',현공정:state,수량:1},{id:'late',PND:'2026-11-20',[completion]:'2026-11-21',현공정:state,수량:1},{id:'open',PND:'2026-11-20',[completion]:'2026-11-19',현공정:part==='part2'?'조립2[HA2]':'조립'},{id:'no-pnd',PND:'',[completion]:'2026-11-20',현공정:state},{id:'no-actual',PND:'2026-11-20',[completion]:'',현공정:state},{id:'invalid',PND:'2026-11-20',[completion]:'2026-02-30',현공정:state}];return {records,meta,part,completion};}
test('both parts use verified final completion and completed states; same-day is on time; counts are not quantity weighted',()=>{
 for(const part of ['part1','part2']){const {records,meta}=fixture(part),m=productionAdherence(records,{part,meta});assert.equal(m.status,'available');assert.equal(m.eligible,3);assert.equal(m.onTime.length,2);assert.equal(m.late.length,1);assert.equal(m.excluded.length,4);assert.equal(m.rate,2/3*100);assert.deepEqual(m.onTime.map(r=>r.record.id),['same','early']);assert(m.excluded.find(r=>r.record.id==='open').reasons.some(r=>r.includes('미완료')));
  const chosen=records.filter(r=>['late','no-actual'].includes(r.id)),view=productionAdherence(chosen,{part,meta,allRecords:records});assert.equal(view.eligible,1);assert.equal(view.rate,0);assert.equal(view.excluded.length,1);assert.equal(view.onTime.length+view.late.length+view.excluded.length,chosen.length);
 }
});
test('no source/blank final dates cannot become a completion percentage; data with no eligible row is empty',()=>{
 for(const part of ['part1','part2']){const {records,meta,completion}=fixture(part);assert.equal(productionAdherence(records,{part,meta:null}).status,'unavailable');assert.equal(productionAdherence(records.map(r=>({...r,[completion]:''})),{part,meta}).status,'unavailable');assert.equal(productionAdherence([records[3]],{part,meta,allRecords:records}).status,'empty');assert.equal(productionAdherence([],{part,meta,allRecords:records}).rate,null);assert.equal(productionAdherence(records,{part,meta:{...meta,part:part==='part1'?'part2':'part1'}}).status,'unavailable');
  const forbidden={part,columns:[{id:'c1',position:1,title:'PND'},{id:'c2',position:2,title:'최신공정완료일'}],mapping:{PND:'c1',[completion]:'c2'}};assert.equal(productionAdherence(records,{part,meta:forbidden}).status,'unavailable');
 }
});
test('actual part-specific reader mappings feed the same adherence evidence; Excel epochs remain calendar dates',()=>{
 const one=parseProductionSheet(writeTable(['PND','현공정','수량','분류','실제완료일'],[['2026-11-20','납품준비',1,'AC','2026-11-20']]),()=>{},'part1'),oneRecords=one.rows.map(r=>normalizeProductionRow(r,one.meta));assert.equal(productionAdherence(oneRecords,{part:'part1',meta:one.meta}).rate,100);
 const two=parseProductionSheet(ahuBytes(1,{rows:[['가상 야드','00001','완료','2026-11-20',1,'ITEM','WO','AHU','HKA-08SN','2026-11-21','2026-11-19']]}),()=>{},'part2'),twoRecords=two.rows.map(r=>normalizeProductionRow(r,two.meta));assert.equal(productionAdherence(twoRecords,{part:'part2',meta:two.meta}).late.length,1);
 const {meta}=fixture('part2');assert.equal(productionAdherence([{PND:1,최종완료일:0,현공정:'완료'}],{part:'part2',meta:{...meta,date1904:true}}).rate,100);
});
