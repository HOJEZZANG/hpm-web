import test from 'node:test';import assert from 'node:assert/strict';
import {filterOrders,summary,validDate,processFields} from '../business/cond-eva-view.mjs';
test('date registration counts keep SHELL request separate, preserve missing/invalid and apply searches',()=>{
 const items=[{work_order:'001',hull:'H-1',project:'프로젝트 A',equipment:'COND',shell_request_date:'2026-11-10',fu:'2026-11-12'}, {work_order:'002',hull:'H-2',equipment:'EVA',cond_completion_date:'2026-02-30',eva_completion_date:'2026-11-13'}];
 const by=Object.fromEntries(summary(items).map(s=>[s.field,s]));assert.equal(by.shell_request_date.registered,1);assert.equal(by.cond_completion_date.registered,0);assert.equal(by.cond_completion_date.invalid,1);assert.equal(by.eva_completion_date.rate,50);assert.equal(by.hydro.registered,0);
 for(const query of ['001','h-1','프로젝트','cond','H-1 프로젝트'])assert.equal(filterOrders(items,query).length,1);
 assert.equal(summary([])[0].rate,null);assert.equal(processFields.length,9);assert(validDate('2024-02-29'));assert(!validDate('2026-02-29'));assert.equal(items[0].cond_completion_date,undefined);
});
