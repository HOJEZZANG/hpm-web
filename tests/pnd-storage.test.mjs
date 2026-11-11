import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate} from '../business/ahu-pnd.mjs';
import {compareProductionPnd,pndExportRows,filterPndResults} from '../business/ui/pnd-comparison.js';
import {packPndSnapshot,unpackPndSnapshot} from '../business/ui/pnd-storage.js';
const source=(side,row,pnd)=>({yard:'SHI',hull:'0001',spec:side==='erp'?'HKA008SN/ORDER':'HKA-08SN',file:side+'.xlsx',sheet:'Sheet1',row,pnd,date:calendarDate(pnd),unrelatedCells:['DO_NOT_STORE_WORKBOOK'],bytes:new Uint8Array([80,75])});
const conditions={erp:{header:2,yard:4,hull:5,pnd:8,spec:10,selected:[3],targetConfirmed:true},plan:{header:2,yard:2,hull:3,pnd:4,spec:6,selected:[3],targetConfirmed:true},aliases:{}};
function snapshot(results,extra={}){return packPndSnapshot({userId:'account-a',part:'part2',results,files:{erp:'ERP.xlsx',plan:'생산계획.xlsx'},conditions,comparedAt:'2026-11-06T00:30:00.000Z',view:{search:'0001',status:'',page:0},...extra});}
test('compact cache preserves every displayed source/candidate and exactly the existing export content, without original cells or bytes',()=>{
 const rows=compareProductionPnd({erp:[source('erp',3,'2026-11-10')],plan:[source('plan',3,'2026-11-20')]}),packed=snapshot(rows),restored=unpackPndSnapshot(structuredClone(packed),'account-a','part2');
 assert.deepEqual(pndExportRows(restored),pndExportRows(rows));assert.deepEqual(restored.map(r=>[r.id,r.status,r.diff,r.label]),rows.map(r=>[r.id,r.status,r.diff,r.label]));assert.equal(filterPndResults(restored,'0001','advanced').length,1);
 assert(!JSON.stringify(packed).includes('DO_NOT_STORE_WORKBOOK'));assert(!JSON.stringify(packed).includes('unrelatedCells'));assert(!JSON.stringify(packed).includes('bytes'));assert.equal(packed.comparedAt,'2026-11-06T00:30:00.000Z');assert.deepEqual(packed.conditions.erp.selected,[3]);
});
test('shared sources are pooled rather than duplicating workbook rows across ambiguous candidate edges',()=>{
 const erp=Array.from({length:5},(_,i)=>source('erp',i+3,'2026-11-10')),plan=Array.from({length:5},(_,i)=>source('plan',i+3,'2026-11-20')),rows=compareProductionPnd({erp,plan}),packed=snapshot(rows),restored=unpackPndSnapshot(packed,'account-a','part2');
 assert.equal(packed.sources.length,10);assert.equal(packed.rows.reduce((n,r)=>n+r.candidates.length,0),50);assert.deepEqual(pndExportRows(restored),pndExportRows(rows));
});
test('account/part, schema and source-reference mismatches cannot restore another result or unsafe selector identifiers',()=>{
 const rows=compareProductionPnd({erp:[source('erp',3,'2026-11-10')],plan:[source('plan',3,'2026-11-20')]}),packed=snapshot(rows);
 assert.throws(()=>unpackPndSnapshot(packed,'account-b','part2'));assert.throws(()=>unpackPndSnapshot(packed,'account-a','part1'));
 for(const alter of [p=>p.version=99,p=>p.rows[0].id='" onclick=',p=>p.rows[0].erp=[99999],p=>p.rows[0].status='<script>',p=>p.comparedAt='invalid']){const bad=structuredClone(packed);alter(bad);assert.throws(()=>unpackPndSnapshot(bad,'account-a','part2'));}
 const second=snapshot(rows,{part:'part1'});assert.notEqual(second.key,packed.key);
});
test('zero-row normal comparisons remain valid snapshots and calculations/time are not recomputed during restore',()=>{
 const packed=snapshot([]),copy=structuredClone(packed);assert.deepEqual(unpackPndSnapshot(copy,'account-a','part2'),[]);assert.equal(copy.comparedAt,packed.comparedAt);assert.equal(copy.algorithm,'erp-minus-plan-v2');
});
