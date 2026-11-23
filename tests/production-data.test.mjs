import test from 'node:test';import assert from 'node:assert/strict';
import {loadProductionSnapshot,productionOverview,productionBucket} from '../business/ui/production-data.js';
import {productionView,ahuView} from '../business/ui/production-view.js';
import {productionDisplay} from '../business/ui/production-display.js';
import {productionPriority} from '../business/ui/production-priority.js';
test('dashboard and schedule reuse one pinned saved snapshot and the same part/filter/process/date rules',async()=>{
 for(const part of ['part1','part2']){const rows=[['2026-11-22',part==='part2'?'조립2[HA2]':'조립'],['2026-11-23','완료'],['2026-11-29',part==='part2'?'조립2[HA2]':'조립'],['2026-11-30',part==='part2'?'조립2[HA2]':'조립'],['2026-11-22',''],['','신규 공정']].map(([PND,현공정],i)=>({id:'shared-'+part+'_'+i,PND,현공정,분류:'AC','LINE 5000':'AHU',Yard:i%2?'STX':'KSB',HullNo:'000'+i,수량:2}));let bodyReads=0;globalThis.window={hpmServerUser:{id:'model-'+part,role:'user'},apiRequest:async path=>path.includes('imports/latest')?{record:{id:'shared-'+part,sha256:'fixed',row_count:rows.length}}:(bodyReads++,{importId:'shared-'+part,imported:{row_count:rows.length},records:rows,nextOffset:null})};
  const snapshot=await loadProductionSnapshot(part);await loadProductionSnapshot(part);assert.equal(bodyReads,1);for(const filters of [{},{Yard:'STX'},{q:'0000'},{equipment:part==='part2'?'AHU':'AC'}]){const expected=part==='part2'?ahuView(rows,filters,{},'2026-11-23'):productionView(rows,filters,'분류',{},'2026-11-23'),model=productionOverview(snapshot,filters,{},'2026-11-23');assert.deepEqual(model.view.records,expected.records);assert.deepEqual(model.view.display,productionDisplay(expected,part,part==='part2'?'LINE 5000':'분류'));assert.deepEqual(model.priority,productionPriority(expected.records,{part,today:'2026-11-23'}));for(const key of ['overdue','upcoming','unknown'])assert.equal(productionBucket(model,key).length,model.priority[key].length);assert(productionBucket(model,'active').every(r=>r.현공정!=='완료'&&r.현공정));}
 }
 delete globalThis.window;
});
test('empty source is distinct from errors; partial or mismatched reads cannot replace an earlier snapshot',async()=>{
 let fail=false,phase='good';const record={id:'pin',sha256:'s',row_count:1};globalThis.window={hpmServerUser:{id:'read-state',role:'user'},apiRequest:async path=>{if(fail)throw Error('合成 조회 실패');if(path.includes('imports/latest'))return {record:phase==='empty'?null:{...record,id:phase==='partial'?'partial':'pin'}};return {importId:phase==='partial'?'partial':'pin',imported:{row_count:1},records:phase==='partial'?[]:[{id:'pin_2',PND:'2026-11-23',현공정:'조립',분류:'AC'}],nextOffset:null};}};
 const good=await loadProductionSnapshot('part1');fail=true;await assert.rejects(()=>loadProductionSnapshot('part1'));assert.equal(good.records.length,1);fail=false;phase='partial';await assert.rejects(()=>loadProductionSnapshot('part1'),/전체 행/);phase='empty';const empty=await loadProductionSnapshot('part1');assert.equal(empty.state,'empty');assert.equal(empty.record,null);delete globalThis.window;
});
test('a late response from another login cannot populate the shared production cache',async()=>{
 let resolve;globalThis.window={hpmServerUser:{id:'before-auth',role:'user'},apiRequest:()=>new Promise(r=>resolve=r)};const promise=loadProductionSnapshot('part2');window.hpmServerUser={id:'after-auth',role:'user'};resolve({record:null});await assert.rejects(()=>promise,/계정이 변경/);delete globalThis.window;
});
