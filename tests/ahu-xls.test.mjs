// Synthetic BIFF bytes only. No company workbooks or converted operational files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CFB,utils,write} from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import {openAhuWorkbook} from '../business/ahu-workbook.mjs';
import {extractAhuRows} from '../business/ahu-xlsx.mjs';
import {comparePnd,AHU_LIMITS,exportRows} from '../business/ahu-pnd.mjs';
import {ahuFixture} from './support/ahu-pnd-fixtures.mjs';
const config={header:1,yard:1,hull:2,pnd:3,selected:[2]};
function workbook(rows,change=()=>{},options={}){
  const book=utils.book_new(),sheet=utils.aoa_to_sheet(rows);utils.book_append_sheet(book,sheet,'가상 자료');change(book,sheet);
  return new Uint8Array(write(book,{type:'array',bookType:'biff8',...options}));
}
function addRecord(bytes,id,body){
  const cfb=CFB.read(bytes,{type:'array'}),entry=CFB.find(cfb,'/Workbook'),source=entry.content,at=4+source[2]+source[3]*256,record=new Uint8Array(4+body.length),view=new DataView(record.buffer);
  view.setUint16(0,id,true);view.setUint16(2,body.length,true);record.set(body,4);
  const next=new Uint8Array(source.length+record.length);next.set(source.subarray(0,at));next.set(record,at);next.set(source.subarray(at),at+record.length);
  const nextView=new DataView(next.buffer);for(let offset=0;offset+4<=next.length;){const kind=nextView.getUint16(offset,true),size=nextView.getUint16(offset+2,true);if(kind===0x0085)nextView.setUint32(offset+4,nextView.getUint32(offset+4,true)+record.length,true);offset+=4+size;}
  CFB.utils.cfb_add(cfb,'/Workbook',next);
  return new Uint8Array(CFB.write(cfb,{type:'array'}));
}
test('AHU format dispatch reads genuine BIFF XLS and XLSX bytes, rejects renamed and text-disguised files',async()=>{
  for(const format of ['xls','xlsx']){const fixture=await ahuFixture('erp',format),book=openAhuWorkbook(fixture.bytes,fixture.filename);assert.equal(book.format,format);assert.equal(book.sheets.length,2);assert.equal(book.readSheet(1).name,'가상 ERP 자료');assert.throws(()=>openAhuWorkbook(fixture.bytes,'가상.'+(format==='xls'?'xlsx':'xls')),/확장자/);}
  assert.throws(()=>openAhuWorkbook(new TextEncoder().encode('<html><table><tr><td>001</td></tr></table></html>'),'가상.xls'),/HTML/);
  assert.throws(()=>openAhuWorkbook(new Uint8Array(AHU_LIMITS.file+1),'가상.xls'),/10MiB/);
  assert.throws(()=>openAhuWorkbook(new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),'가상.xls'),/손상/);
});
test('AHU BIFF XLS mixed with XLSX preserves Korean, zero prefixes, duplicate rows, provenance and comparison states',async()=>{
  const sources={};for(const [side,format]of [['erp','xls'],['plan','xlsx']]){
    const f=await ahuFixture(side,format),book=openAhuWorkbook(f.bytes,f.filename),sheet=book.readSheet(1);
    assert.deepEqual(sheet.preview,book.readSheet(1).preview,'Repeated sheet reads must not reuse an exhausted BIFF cursor');
    const selected=sheet.rows.filter(r=>r.number>f.header&&r.cells.get(1)?.value==='가상 AHU').map(r=>r.number);
    sources[side]=extractAhuRows(sheet,{header:f.header,yard:2,hull:3,pnd:4,selected},f.filename);
  }
  const result=comparePnd(sources.erp,sources.plan);assert.equal(result[0].label,'9일 당겨짐');assert.equal(result.filter(r=>r.status==='advanced').length,2);assert.equal(result.filter(r=>r.status==='delayed').length,1);
  assert.equal(result.filter(r=>r.label==='중복 확인 필요').length,2);assert.equal(result.find(r=>r.hull==='00123').status,'same');assert(result.some(r=>r.hull==='H-00A'));assert(result.some(r=>r.reasons.some(s=>s.includes('빈 날짜'))));
  assert(result.every(r=>r.erp.every(s=>s.file.endsWith('.xls')&&s.sheet==='가상 ERP 자료'&&s.row>3)));
});
test('AHU BIFF numeric formats, both date epochs, cached formulas and unsafe identifiers remain explicit',()=>{
  const bytes=workbook([['야드','호선','PND'],['가상',12,46336],['가상',1234567890123456,46336],['가상','H-00A',0],['가상','00004',0]],(book,sheet)=>{
    // Serialized BIFF tokens for 1+1; deliberately different cached value proves no evaluation.
    const bf=[7,0,0x1e,1,0,0x1e,1,0,0x03];
    sheet.B2.z='"H-"00000';sheet.C2={t:'n',v:46336,bf,z:'yyyy-mm-dd'};sheet.C4={t:'n',bf};sheet.C5={t:'e',v:7};
  });
  const sheet=openAhuWorkbook(bytes,'가상.xls').readSheet(0),rows=extractAhuRows(sheet,{...config,selected:[2,3,4,5]},'가상.xls');
  assert.equal(rows[0].hull,'H-00012');assert.equal(rows[0].date.iso,'2026-11-10');assert(rows[1].keyIssue.includes('정밀도'));assert(rows[2].date.reason.includes('계산값'));assert(rows[3].date.reason.includes('오류'));
  const epoch=workbook([['야드','호선','PND'],['가상','00001',0]],book=>book.Workbook={WBProps:{date1904:true}});
  assert.equal(extractAhuRows(openAhuWorkbook(epoch,'가상.xls').readSheet(0),config,'가상.xls')[0].date.iso,'1904-01-01');
  const invalid=workbook([['야드','호선','PND'],['가상','00001',60]]);assert(extractAhuRows(openAhuWorkbook(invalid,'가상.xls').readSheet(0),config,'가상.xls')[0].date.reason);
});
test('AHU BIFF5 reads Korean with the explicit original code page',()=>{
  // The CE BIFF5 writer only emits CP1252. Install real CP949 bytes in its same-size Label record.
  const encoded=cptable.utils.encode(949,'가상 조선소'),bytes=workbook([['yard','hull','PND'],['X'.repeat(encoded.length),'H-0001','2026-11-10']],()=>{},{bookType:'biff5'}),cfb=CFB.read(bytes,{type:'array'}),stream=new Uint8Array(CFB.find(cfb,'/Book').content),view=new DataView(stream.buffer);let changed=false;
  for(let offset=0;offset+4<=stream.length;){const id=view.getUint16(offset,true),size=view.getUint16(offset+2,true),start=offset+4;if(id===0x0042)view.setUint16(start,949,true);if(id===0x0204&&view.getUint16(start,true)===1&&view.getUint16(start+2,true)===0){stream.set(encoded,start+8);changed=true;}offset=start+size;}
  assert(changed);CFB.utils.cfb_add(cfb,'/Book',stream);
  const row=extractAhuRows(openAhuWorkbook(new Uint8Array(CFB.write(cfb,{type:'array'})),'가상.xls').readSheet(0),config,'가상.xls')[0];assert.equal(row.yard,'가상 조선소');assert.equal(row.hull,'H-0001');assert.equal(row.date.iso,'2026-11-10');
});
test('AHU BIFF rejects macro containers, encryption and corrupt or truncated records',()=>{
  const bytes=workbook([['야드','호선','PND'],['가상','00001',46336]]);
  assert.throws(()=>openAhuWorkbook(addRecord(bytes,0x002f,new Uint8Array([0,0])),'가상.xls'),/암호화/);
  const cfb=CFB.read(bytes,{type:'array'});CFB.utils.cfb_add(cfb,'/_VBA_PROJECT_CUR/VBA/dir',new Uint8Array([1]));assert.throws(()=>openAhuWorkbook(new Uint8Array(CFB.write(cfb,{type:'array'})),'가상.xls'),/매크로/);
  const bad=CFB.read(bytes,{type:'array'}),entry=CFB.find(bad,'/Workbook');CFB.utils.cfb_add(bad,'/Workbook',entry.content.subarray(0,entry.content.length-1));assert.throws(()=>openAhuWorkbook(new Uint8Array(CFB.write(bad,{type:'array'})),'가상.xls'),/잘렸|완결|손상/);
});
test('AHU BIFF external references use cached values only and keep the notice in provenance and export',()=>{
  const bytes=workbook([['야드','호선','PND'],['가상','00001',46336]]),linked=addRecord(bytes,0x01ae,new Uint8Array([0,0,1,0,0,65])),book=openAhuWorkbook(linked,'가상.xls');
  assert(book.notices[0].includes('갱신하지 않고'));const rows=extractAhuRows(book.readSheet(0),config,'가상.xls');assert.equal(rows[0].date.iso,'2026-11-10');assert.deepEqual(rows[0].notices,book.notices);
  const result=comparePnd(rows,rows);assert.equal(result[0].status,'same');assert(exportRows(result)[0][7].includes('외부 참조'));
});
test('AHU BIFF budgets count effective rows and cells instead of trusting formatting-only ranges',()=>{
  const far=workbook([['야드','호선','PND'],['가상','00001',46336]],(book,sheet)=>{sheet['!ref']='A1:D65536';sheet.D65536={t:'z',z:'0'};});
  assert.equal(openAhuWorkbook(far,'가상.xls').readSheet(0).rows.length,2);
  const many=workbook(Array.from({length:AHU_LIMITS.rows+1},()=>['가상']));assert.throws(()=>openAhuWorkbook(many,'가상.xls').readSheet(0),/20,000/);
});
