import test from 'node:test';import assert from 'node:assert/strict';
import {calendarDate} from '../business/ahu-pnd.mjs';
import {compareProductionPndWithScope,filterPndResults,pndExportRows,isExcludedAlomHull} from '../business/ui/pnd-comparison.js';
import {packPndSnapshot,unpackPndSnapshot} from '../business/ui/pnd-storage.js';
const row=(side,hull,extra={})=>({yard:'HDE',hull,spec:side==='erp'?'HKA008SN/ORDER':'HKA-08SN',row:3,file:side+'.xlsx',sheet:side==='erp'?'Sheet1':'ALL',pnd:'2026-11-23',date:calendarDate('2026-11-23'),...extra});
test('ALOM is an exact cleaned hull identifier on both sources, never a yard or a substring exclusion',()=>{
 for(const value of ['ALOM',' alom ','\nAlOm\r\n','AL\nOM'])assert(isExcludedAlomHull(value));for(const value of ['XALOM','ALOM-1','AL OM','HDE'])assert(!isExcludedAlomHull(value));
 const erp=['ALOM','0001','ALOM-1'].map((h,i)=>row('erp',h,{row:i+3})),plan=[' alom\n','0001','ALOM-1'].map((h,i)=>row('plan',h,{row:i+7})),before=structuredClone({erp,plan}),{results,scope}=compareProductionPndWithScope({erp,plan});assert.equal(results.length,2);assert.deepEqual(new Set(results.map(r=>r.hull)),new Set(['0001','ALOM-1']));assert.equal(scope.erpAlom,1);assert.equal(scope.planAlom,1);assert.deepEqual({erp,plan},before);assert(results.every(r=>r.yard==='HDE'));
});
test('only plan rows produce results; missing ERP, differing specifications and duplicate candidates keep their plan row',()=>{
 const erp=[row('erp','0001'),row('erp','ERP-ONLY'),row('erp','0003',{spec:'HKA010SN/ORDER',row:5}),row('erp','0004',{row:6}),row('erp','0004',{row:7})],plan=['0001','PLAN-ONLY','0003','0004'].map((h,i)=>row('plan',h,{row:i+7})),{results,scope}=compareProductionPndWithScope({erp,plan});
 assert.equal(results.length,plan.length);assert(results.every(r=>r.plan.length===1));assert.equal(scope.erpStandalone,4);assert.equal(filterPndResults(results,'ERP-ONLY','').length,0);assert(results.find(r=>r.planHull==='PLAN-ONLY').label.includes('ERP 연결 확인 필요'));assert(results.find(r=>r.planHull==='0003').reasons.some(r=>r.includes('유일한 연결')));assert(results.find(r=>r.planHull==='0004').reasons.some(r=>r.includes('복수 후보')));assert.equal(results.find(r=>r.planHull==='0004').candidates.filter(c=>c.hull&&c.spec).length,2);
});
test('plan duplicates remain independent review rows and STX/KSB yard equivalence is preserved',()=>{
 const erp=[row('erp','0001',{yard:'STX'})],plan=[row('plan','0001',{yard:'KSB'}),row('plan','0001',{yard:'KSB',row:8})];const duplicate=compareProductionPndWithScope({erp,plan});assert.equal(duplicate.results.length,2);assert(duplicate.results.every(r=>!r.linked));const unique=compareProductionPndWithScope({erp,plan:plan.slice(0,1)}).results;assert(unique[0].linked);assert.match(unique[0].linkBasis,/STX\/KSB/);
});
test('scope metadata, cards/search/export and restored result all refer to the same baseline rows',()=>{
 const erp=[row('erp','ALOM'),row('erp','0001'),row('erp','ERP-ONLY')],plan=[row('plan','ALOM'),row('plan','0001'),row('plan','PLAN-ONLY',{row:8})],{results,scope}=compareProductionPndWithScope({erp,plan}),config={header:2,yard:1,hull:2,pnd:3,spec:4,selected:[3],targetConfirmed:true},snapshot=packPndSnapshot({userId:'scope-reader',part:'part2',results,scope,files:{erp:'e.xlsx',plan:'p.xlsx'},conditions:{erp:config,plan:config}}),restored=unpackPndSnapshot(snapshot,'scope-reader','part2');
 assert.equal(scope.planIncluded,2);assert.equal(results.length,2);assert.deepEqual(snapshot.comparisonScope,scope);assert.deepEqual(pndExportRows(restored),pndExportRows(results));assert.equal(['advanced','delayed','review','same'].reduce((n,status)=>n+filterPndResults(restored,'',status).length,0),2);assert.equal(filterPndResults(restored,'ALOM','').length,0);assert.equal(pndExportRows(restored).length,2);const invalid=structuredClone(snapshot);invalid.comparisonScope.planIncluded=3;assert.throws(()=>unpackPndSnapshot(invalid,'scope-reader','part2'));
});
