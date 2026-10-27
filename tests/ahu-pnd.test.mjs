import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {calendarDate,comparePnd,filterResults,exportRows,exportColumns,AHU_LIMITS} from '../business/ahu-pnd.mjs';
import {openAhuWorkbook,extractAhuRows} from '../business/ahu-xlsx.mjs';
import {writeTable} from '../business/ooxml.mjs';
import {ahuFixture} from './support/ahu-pnd-fixtures.mjs';
const row=(hull,pnd,extra={})=>({yard:'가상 YARD',hull,spec:'HKA-08SN',pnd,row:2,file:'가상 자료.xlsx',sheet:'가상 시트',date:calendarDate(pnd),...extra});
test('AHU calendar dates ignore timezone and time, validate leap days and both Excel epochs',()=>{
  assert.equal(calendarDate('2026-03-08T23:30:00-10:00').day,calendarDate('2026-03-08').day);
  assert.equal(calendarDate('2026/3/9').day-calendarDate('2026.3.8').day,1);
  assert.equal(calendarDate('20240229').iso,'2024-02-29');assert(calendarDate('20260229').reason);assert(calendarDate('03/04/2026').reason);
  assert.equal(calendarDate(1).iso,'1900-01-01');assert.equal(calendarDate(59.9).iso,'1900-02-28');assert(calendarDate(60).reason);assert.equal(calendarDate(61).iso,'1900-03-01');assert.equal(calendarDate(0,true).iso,'1904-01-01');assert(calendarDate('').reason);assert(calendarDate(NaN).reason);
});
test('AHU comparison preserves leading zero, letters and punctuation, sorts and uses signed calendar days',()=>{
  const erp=['001','A-001','002','003'].map(h=>row(h,'2026-11-10')),plan=[row('001','2026-11-05'),row('A-001','2026-11-01'),row('002','2026-11-12'),row('003','2026-11-10'),row('1','2026-11-10')];
  const result=comparePnd(erp,plan);assert.deepEqual(result.map(r=>r.status),['advanced','advanced','delayed','review','same']);assert.equal(result[0].hull,'A-001');assert.equal(result[0].label,'9일 당겨짐');assert.equal(result[1].diff,-5);assert.equal(result[2].label,'2일 지연');assert.equal(result.at(-1).label,'일치');
  assert.equal(filterResults(result,'A-001','advanced').length,1);assert.equal(exportRows(result).length,5);
});
test('AHU duplicates, missing keys, one-sided rows and date errors keep all provenance without selecting a winner',()=>{
  const result=comparePnd([row('D','2026-11-10'),row('D','2026-11-12',{row:3}),row('B',''),row('X','2026-02-30'),row('','2026-11-10'),row('only','2026-11-10')],[row('D','2026-11-10'),row('B','2026-11-10'),row('X','2026-11-10'),row('','2026-11-10'),row('plan-only','2026-11-10')]);
  assert(result.every(r=>r.status==='review'&&r.diff===null));const duplicate=result.filter(r=>r.hull==='D');assert.equal(duplicate.length,3);assert(duplicate.every(r=>r.erp.length+r.plan.length===1&&r.reasons.some(s=>s.includes('복수'))));assert.equal(result.filter(r=>!r.hull).length,2);assert(result.find(r=>r.hull==='B').reasons.some(r=>r.includes('빈 날짜')));assert(result.find(r=>r.hull==='X').reasons.some(r=>r.includes('날짜')));
  assert(exportRows(duplicate).some(r=>r[7].includes('3행')));assert.equal(exportRows(duplicate)[0].length,exportColumns.length);
});
test('AHU yard aliases annotate confirmed names without replacing hull/spec uniqueness or merging records',()=>{
  const a=[row('001','2026-11-10',{yard:'가상 정식'})],b=[row('001','2026-11-10',{yard:'가상 별칭'})];
  assert.equal(comparePnd(a,b).length,1);assert.equal(comparePnd(a,b)[0].linkBasis,'호선·규격 일치 / 야드 표기 다름');assert.equal(comparePnd(a,b,{'가상 별칭':'가상 정식'})[0].status,'same');
  const duplicate=comparePnd(a,[...b,row('001','2026-11-10',{yard:'가상 정식'})],{'가상 별칭':'가상 정식'});assert.equal(duplicate.length,3);assert(duplicate.every(r=>!r.linked));
});
test('AHU arbitrary sheets, header rows, columns and explicit mixed-product selections work without schema inference',async()=>{
  const extracted={};for(const side of ['erp','plan']){const fixture=await ahuFixture(side),book=openAhuWorkbook(fixture.bytes);assert.equal(book.sheets.length,2);const sheet=book.readSheet(1);assert.equal(sheet.rows[0].number,1);const selected=sheet.rows.filter(r=>r.number>fixture.header&&r.cells.get(1)?.value==='가상 AHU').map(r=>r.number);extracted[side]=extractAhuRows(sheet,{header:fixture.header,yard:2,hull:3,pnd:4,spec:6,selected},fixture.filename);assert(extracted[side].some(r=>r.hull==='00123'));assert(!extracted[side].some(r=>r.pnd==='2026-12-31'));assert.throws(()=>extractAhuRows(sheet,{header:fixture.header,yard:2,hull:3,pnd:4,spec:6,selected:[]},fixture.filename),/직접 선택/);}
  const result=comparePnd(extracted.erp,extracted.plan);assert.equal(result.filter(r=>r.status==='advanced').length,2);assert.equal(result.filter(r=>r.status==='delayed').length,1);assert.equal(result.filter(r=>r.reasons.some(s=>s.includes('중복·복수'))).length,6);assert.equal(result.find(r=>r.hull==='00123').status,'same');assert.equal(result[0].hull,'00102');
});
test('AHU numeric identifiers preserve supported format literals; unsafe precision and cached formula absence are review reasons',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('임의 시트');sheet.addRow(['야드','호선','PND']);sheet.addRow(['가상',12,{formula:'1+1'}]);sheet.getCell('B2').numFmt='"H-"00000';sheet.addRow(['가상',1234567890123456,'2026-11-10']);sheet.addRow(['가상','0000',{formula:'DATE(2026,11,10)',result:46336}]);
  sheet.addRow(['가상',123,'2026-11-10']);sheet.getCell('B5').numFmt='0%';sheet.addRow(['가상',12,'2026-11-10']);sheet.getCell('B6').numFmt='00000;00000';
  const parsed=openAhuWorkbook(new Uint8Array(await book.xlsx.writeBuffer())).readSheet(0),rows=extractAhuRows(parsed,{header:1,yard:1,hull:2,pnd:3,selected:[2,3,4,5,6]},'가상.xlsx');assert.equal(rows[0].hull,'H-00012');assert(rows[0].date.reason.includes('계산값'));assert(rows[1].keyIssue.includes('정밀도'));assert(rows[2].date.iso);assert(rows[3].keyIssue.includes('서식'));assert(rows[4].keyIssue.includes('다중 구간'));
});
test('AHU explicit zero-row confirmation supports a file without AHU while unconfirmed empty selection is rejected',()=>{
  const sheet=openAhuWorkbook(writeTable(['yard','hull','date'],[['가상','001','2026-11-10']])).readSheet(0),config={header:1,yard:1,hull:2,pnd:3,selected:[]};assert.throws(()=>extractAhuRows(sheet,config,'가상.xlsx'),/직접 선택/);assert.deepEqual(extractAhuRows(sheet,{...config,targetConfirmed:true},'가상.xlsx'),[]);assert.equal(comparePnd([],[row('001','2026-11-10')])[0].status,'review');
});
test('AHU bounded reader rejects invalid, encrypted/macro input and oversized files instead of silently truncating',()=>{
  assert.throws(()=>openAhuWorkbook(new Uint8Array(AHU_LIMITS.file+1)),/10MiB/);assert.throws(()=>openAhuWorkbook(new Uint8Array([1,2,3])),/엑셀/);
  const source=unzipSync(writeTable(['A'],[['가상']]));source['xl/vbaProject.bin']=new Uint8Array([1]);assert.throws(()=>openAhuWorkbook(zipSync(source)),/매크로/);
  const encrypted=writeTable(['A'],[['가상']]),view=new DataView(encrypted.buffer,encrypted.byteOffset,encrypted.byteLength);for(let i=0;i<encrypted.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint16(i+8,1,true);break;}assert.throws(()=>openAhuWorkbook(encrypted),/암호화/);
  const many=Array.from({length:AHU_LIMITS.rows+1},()=>['가상']);assert.throws(()=>openAhuWorkbook(writeTable(['A'],many)).readSheet(0),/20,000/);
});
test('AHU export rejects oversized provenance cells instead of truncating duplicate evidence',()=>{
  const rows=Array.from({length:500},(_,i)=>row('duplicate','2026-11-10',{row:i+2,file:'가상 검증 파일 이름'.repeat(10)+'.xlsx'}));assert.throws(()=>exportRows(comparePnd(rows,[row('duplicate','2026-11-10')])),/32,767/);
});
test('AHU exported cells remain text even when starting with formula characters',()=>{
  const source=unzipSync(writeTable(exportColumns,exportRows(comparePnd([row('=1+1','2026-11-10')],[row('=1+1','2026-11-10')]))));const xml=new TextDecoder().decode(source['xl/worksheets/sheet1.xml']);assert(xml.includes('=1+1'));assert(!xml.includes('<f>'));
});
