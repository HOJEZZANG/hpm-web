import test from 'node:test';
import assert from 'node:assert/strict';
import {productionDisplay} from '../business/ui/production-display.js';
import {productionView,ahuView} from '../business/production-view.mjs';
const today='2026-10-31';
test('display summary and graph use exactly the selected part-2 records and retain every original equipment value',()=>{
  const rows=[['AHU','조립2[HA2]',2],['AHU','완료',3],['AHU (특수선)','',1],['AHU WITH ECONOVENT','미확인',1],['새 장비','',4]].map(([eq,p,q],i)=>({id:String(i),'LINE 5000':eq,현공정:p,수량:q,PND:i===1?'2026-10-01':'2026-11-02',Yard:'상선·특수선 판정에 사용하지 않는 원문'}));
  for(const selection of [{},{equipment:'AHU'},{status:'ready'},{risk:'upcoming'},{equipment:'AHU',status:'active'}]){
    const view=ahuView(rows,{},selection,today),d=productionDisplay(view,'part2','LINE 5000');assert.equal(d.summary.total,view.records.length);assert.equal(d.groups.reduce((s,g)=>s+g.total,0),view.records.length);assert.equal(d.groups.reduce((s,g)=>s+g.quantity,0),d.summary.quantity);assert.equal(d.summary.total,d.summary.active+d.summary.ready+d.summary.unknown);assert(d.groups.every(g=>g.total===g.active+g.ready+g.unknown));
  }
  const d=productionDisplay(ahuView(rows,{}, {},today),'part2','LINE 5000');assert.equal(d.summary.quantity,11);assert.deepEqual(new Set(d.groups.map(g=>g.name)),new Set(rows.map(r=>r['LINE 5000'])));assert.equal(d.summary.ready,1);assert.equal(d.summary.unknown,3);
});
test('part-1 display preserves its APR rule while quantities, process drilldown and dates stay aligned with exported records',()=>{
  const rows=[{분류:'MGO',현공정:'완료',수량:4,PND:'2026-10-01'},{분류:'MGO',현공정:'납품준비 [APR]',수량:2,PND:'2026-10-01'},{분류:'기타 장비 원문',현공정:'조립',수량:3,PND:'2026-11-01'}];
  const view=productionView(rows,{},'분류',{},today),d=productionDisplay(view,'part1','분류');assert.equal(d.summary.ready,1);assert.equal(d.summary.unknown,1);assert.equal(d.summary.quantity,9);assert.deepEqual(d.groups.map(g=>g.name),['MGO','기타 장비 원문']);
  const picked=productionView(rows,{},'분류',{equipment:'MGO',process:'완료'},today),shown=productionDisplay(picked,'part1','분류');assert.equal(shown.summary.total,1);assert.equal(shown.summary.unknown,1);assert.equal(shown.groups[0].steps[0].name,'완료');assert.equal(shown.summary.overdue,0);
});
