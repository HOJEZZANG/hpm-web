import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAhuModel,confirmedYardConflict} from '../business/ahu-models.mjs';
import {comparePnd,calendarDate,exportRows,exportColumns,filterResults} from '../business/ahu-pnd.mjs';
import {applyAhuPreset} from '../business/ahu-presets.mjs';
import {openAhuWorkbook} from '../business/ahu-workbook.mjs';
import {ahuPresetFixture} from './support/ahu-pnd-fixtures.mjs';
const row=(hull,spec='HKA-08SN',yard='가상 야드',number=2)=>({yard,hull,spec,row:number,file:'가상.xlsx',sheet:'가상',pnd:'2026-11-10',date:calendarDate('2026-11-10'),keyIssue:''});
const owned=results=>results.flatMap(r=>[...r.erp,...r.plan]).map(r=>r.sourceId);
test('verified model structures normalize full model tokens and preserve all option tokens',()=>{
  const a=normalizeAhuModel('HKA008SN/SYNTH0001','erp'),b=normalizeAhuModel(' hka - 08 sn ');assert.equal(a.key,b.key);assert.equal(a.value,'HKA-8SN');assert.equal(a.model,'HKA008SN');
  assert.notEqual(a.key,normalizeAhuModel('HKA-08SO').key);assert.notEqual(a.key,normalizeAhuModel('HKA-08SN-A').key);assert.notEqual(normalizeAhuModel('HKA-08SN-A').key,normalizeAhuModel('HKA-08SN-AB').key);assert.notEqual(normalizeAhuModel('HKA-08SN-AB').key,normalizeAhuModel('HKA-08SN-A-B').key);
  assert.equal(normalizeAhuModel('HKA-08SN - A').key,normalizeAhuModel('HKA008SN-A/ID','erp').key);
  assert.equal(normalizeAhuModel('HKA-13/12').key,normalizeAhuModel('HKA01312/ID','erp').key);assert(!normalizeAhuModel('HKA-13/13').key);assert(!normalizeAhuModel('HKA00000/ID','erp').key);assert(!normalizeAhuModel('571-GA-001-A').key);assert(!normalizeAhuModel('prefix-HKA-08SN').key);
});
test('same hull and normalized spec link across unknown yard spellings while retaining both raw sources',()=>{
  const [r]=comparePnd([row('H-001','HKA008SN/ORDER','가상 ERP')],[row('H-001','HKA-08SN','가상 계획')]);assert.equal(r.status,'same');assert(r.linked);assert.equal(r.linkBasis,'호선·규격 일치 / 야드 표기 다름');assert.equal(r.erpYard,'가상 ERP');assert.equal(r.planYard,'가상 계획');assert.equal(r.erpSpec,'HKA008SN/ORDER');assert.equal(r.planNormalized,r.erpNormalized);assert.equal(r.candidateCount,1);assert.equal(r.eligibleCount,1);assert(r.candidates[0].reason.includes('유일성 확인'));
});
test('same hull with several specs and same spec across hulls resolve by mutual unique hull/model pairs',()=>{
  const erp=[row('A','HKA008SN/1'),row('A','HKA007SN/2','가상 야드',3),row('B','HKA008SN/3','가상 야드',4)],plan=[row('A','HKA-08SN'),row('A','HKA-07SN','가상 표기',3),row('B','HKA-08SN','가상 표기',4)];
  const results=comparePnd(erp,plan);assert.equal(results.length,3);assert(results.every(r=>r.linked));assert.equal(new Set(owned(results)).size,6);
});
test('OR candidates do not establish a link from yard-only, spec-only or contradictory hull data',()=>{
  const results=comparePnd([row('0001','HKA008SN/1','가상 A')],[row('0002','HKA-08SN','가상 A')]);assert.equal(results.length,2);assert(results.every(r=>!r.linked&&r.diff===null));assert(results[0].candidates[0].reason.includes('호선 다름'));
  const yardOnly=comparePnd([row('A','HKA008SN/1')],[row('B','HKA-09SO')]);assert(yardOnly.every(r=>r.candidateCount===1&&!r.linked));
  const specOnly=comparePnd([row('A','HKA008SN/1','가상 A')],[row('B','HKA-08SN','가상 B')]);assert(specOnly.every(r=>r.candidates[0].spec&&!r.candidates[0].hull&&!r.linked));
});
test('confirmed distinct shipyards stay blocked even when a contradictory alias is supplied',()=>{
  assert(confirmedYardConflict('HHI','SHI'));assert(!confirmedYardConflict('HHI','가상 표기'));
  for(const aliases of [{},{SHI:'HHI'}]){const result=comparePnd([row('A','HKA008SN/1','HHI')],[row('A','HKA-08SN','SHI')],aliases);assert(result.every(r=>!r.linked&&r.reasons.some(s=>s.includes('다른 조선소'))));}
  const [alias]=comparePnd([row('A','HKA008SN/1','HHI')],[row('A','HKA-08SN','가상 별칭')],{'가상 별칭':'HHI'});assert(alias.linked);assert(alias.linkBasis.includes('확인한 야드 별칭'));
});
test('duplicate rows are separate review records; no first row, last date, row merge or reused assignment',()=>{
  const erp=[row('A','HKA008SN/1','가상',2),row('A','HKA008SN/2','가상',3)],plan=[row('A','HKA-08SN')],results=comparePnd(erp,plan);assert.equal(results.length,3);assert(results.every(r=>r.status==='review'&&!r.linked&&r.reasons.some(s=>s.includes('복수'))));assert.equal(owned(results).length,3);assert.equal(new Set(owned(results)).size,3);assert(results.every(r=>r.erp.length+r.plan.length===1));
});
test('missing hull/spec and unverified models are review reasons while dates remain independent of linking',()=>{
  for(const r of [row(''),row('A',''),row('A','HKA00000/ID')])assert(comparePnd([r],[row('A')]).every(x=>x.status==='review'));
  const bad={...row('A','HKA008SN/ID'),pnd:'',date:calendarDate('')},[result]=comparePnd([bad],[row('A')]);assert(result.linked);assert.equal(result.status,'review');assert(result.reasons.some(s=>s.includes('빈 날짜')));
});
test('exports and search expose original specs, normalized values, both yards and candidate reasons',()=>{
  const matched=comparePnd([row('A','HKA008SN/ID','가상 ERP')],[row('A','HKA-08SN','가상 계획')]);assert.equal(filterResults(matched,'HKA008SN/ID').length,1);const values=exportRows(matched)[0];assert.equal(values[exportColumns.indexOf('생산계획 규격 원본')],'HKA-08SN');assert.equal(values[exportColumns.indexOf('ERP 품번 원본')],'HKA008SN/ID');assert.equal(values[exportColumns.indexOf('ERP 원본 야드')],'가상 ERP');
  const review=comparePnd([row('A','HKA008SN/ID')],[row('B','HKA-08SN')]);assert(exportRows(review)[0].at(-1).includes('호선 다름'));
});
test('candidate graph limits fail explicitly rather than returning a truncated or guessed match',()=>{
  const rows=Array.from({length:501},(_,i)=>row('A','HKA-08SN','가상',i+2));assert.throws(()=>comparePnd(rows,rows),/250,000/);
});
test('unverified identical model text is an OR reference candidate but never an automatic specification match',()=>{
  for(const [erp,plan]of [['OTHER-MODEL/ID','OTHER-MODEL'],['HKA01312/ID','HKA01312']]){const results=comparePnd([row('A',erp,'가상 A')],[row('B',plan,'가상 B')]);assert.equal(results.length,2);assert(results.every(r=>!r.linked&&r.candidateCount===1&&r.eligibleCount===0));assert(results[0].candidates[0].reason.includes('규격 원문'));}
});
test('verified presets locate original fields and select only confirmed AHU rules',async()=>{
  const e=await ahuPresetFixture('erp'),p=await ahuPresetFixture('plan','xls');for(const [side,f]of [['erp',e],['plan',p]]){const book=openAhuWorkbook(f.bytes,f.filename),preset=applyAhuPreset(side,book.readSheet(0).preview);assert(preset.ready);assert.equal(preset.config.spec,side==='erp'?10:6);assert.equal(preset.selected.length,3);if(side==='erp')assert.deepEqual(preset.selected,[3,4,7]);}
});
test('preset finds uniquely moved headers and blocks duplicate/missing headers instead of choosing first',async()=>{
  for(const [kind,change]of [['moved',s=>{for(let r=2;r<=7;r++){s.getCell(r,11).value=s.getCell(r,10).value;s.getCell(r,10).value=null;}}],['duplicate',s=>{s.getCell(2,11).value='품번';}],['missing',s=>{s.getCell(2,10).value='다른 제목';}]]){const f=await ahuPresetFixture('erp','xlsx',change),preset=applyAhuPreset('erp',openAhuWorkbook(f.bytes,f.filename).readSheet(0).preview);if(kind==='moved'){assert(preset.ready);assert.equal(preset.config.spec,11);assert.equal(preset.moved.length,1);}else {assert(!preset.ready);assert.equal(preset.selected.length,0);assert(preset.reasons.length);}}
});
test('plan preset rejects unknown or mixed structure and retains missing-cell rows for review',async()=>{
  for(const mutate of [s=>{s.getCell('A1').value='혼합 생산계획';},s=>{s.getCell('F7').value='CHILLER-01';}]){const f=await ahuPresetFixture('plan','xlsx',mutate),preset=applyAhuPreset('plan',openAhuWorkbook(f.bytes,f.filename).readSheet(0).preview);assert(!preset.ready);assert.equal(preset.selected.length,0);}
  const f=await ahuPresetFixture('plan','xlsx',s=>{s.getCell('F7').value=null;}),preset=applyAhuPreset('plan',openAhuWorkbook(f.bytes,f.filename).readSheet(0).preview);assert(preset.ready);assert(preset.selected.includes(7));
});
