import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import {productionView,productionCounts,productionProcessState} from '../business/production-view.mjs';
import {productionWorkbook} from '../business/production-export.mjs';
import {parseProductionSheet} from '../business/production-sheet.mjs';
import {readTable} from '../business/ooxml.mjs';
const today='2026-10-31';
const make=(id,eq,process,pnd,quantity=1)=>({id,분류:eq,현공정:process,PND:pnd,수량:quantity,Yard:eq==='AC'?'합성 A':'합성 B',HullNo:'000'+id,'Work Order':'00017'});
const rows=[make('A1','AC','COND. 취부/용접AC[AC1]','2026-10-30',20),make('A2','AC','납품준비 [APR]','2026-10-01'),make('A3','AC','조립AC[AA1]',today,3),make('P1','PROV','COND.취부/용접[PC1]','2026-11-07',5),make('P2','PROV','PROV 결선[PEL]','2026-11-08',7),make('P3','PROV','알 수 없는 공정','2026-02-30',0),make('D1','DECK','','',10)];
test('explicit process mapping never treats unknown or ambiguous names as complete; exact partitions and date subsets',()=>{
  for(const p of ['납품준비','납품준비 [APR]','납품준비 완료','APR'])assert.equal(productionProcessState(p),'ready');
  for(const p of ['조립','대기','PROV PAINT 작업[PPT]','DECK UNIT BED FRAME 제작[DBP]'])assert.equal(productionProcessState(p),'active');
  for(const p of ['완료','알 수 없음','납품준비 대기','UNKNOWN[APR]','납품준비 [AA1]',''])assert.equal(productionProcessState(p),'unknown');
  assert.deepEqual(productionCounts(rows,today),{total:7,active:4,ready:1,unknown:2,overdue:1,upcoming:2,missingPnd:1,invalidPnd:1});
  const v=productionView(rows,{},'분류',{},today);assert.deepEqual(v.groups.map(g=>[g.name,g.total,g.active,g.ready,g.unknown,g.overdue]),[['AC',3,2,1,0,1],['PROV',3,2,0,1,0],['DECK',1,0,0,1,0]]);
  assert.equal(v.summary.total,v.summary.active+v.summary.ready+v.summary.unknown);assert.equal(rows.reduce((n,r)=>n+r.수량,0),46);
});
test('cards, graph, exact process selection, risk tabs and query filters share the same rows',()=>{
  for(const [selection,ids]of [[{status:'active'},['A1','A3','P1','P2']],[{status:'ready'},['A2']],[{status:'unknown'},['P3','D1']],[{risk:'overdue'},['A1']],[{risk:'upcoming'},['A3','P1']],[{equipment:'PROV',risk:'upcoming'},['P1']],[{equipment:'AC',process:'납품준비 [APR]'},['A2']]])assert.deepEqual(productionView(rows,{},'분류',selection,today).records.map(r=>r.id),ids);
  const context=productionView(rows,{},'분류',{equipment:'PROV'},today);assert.equal(context.summary.total,3);assert.equal(context.summary.unknown,1);
  const p=productionView(rows,{equipment:'AC'},'분류',{equipment:'PROV',process:'PROV 결선[PEL]'},today);assert.equal(p.selection.equipment,'');assert.equal(p.selection.process,null);assert.deepEqual(p.records.map(r=>r.id),['A1','A2','A3']);
  assert.deepEqual(productionView(rows,{from:today,to:'2026-11-07'},'분류',{},today).records.map(r=>r.id),['A3','P1']);
  assert.deepEqual(productionView(rows,{q:'000A2'},'분류',{},today).records.map(r=>r.id),['A2']);
  const empty=productionView([],{},'분류',{},today);assert.equal(empty.summary.total,0);assert.deepEqual(empty.groups,[]);
  const spaced=[make('S','AC','조립',' 2026-10-30 ')],v=productionView(spaced,{},'분류',{risk:'overdue'},today);assert.equal(v.summary.overdue,1);assert.equal(v.records.length,1);assert.equal(productionView(spaced,{from:'2026-10-30',to:'2026-10-30'},'분류',{},today).records.length,1);
});
test('production XLSX dates are sortable date cells with yyyy-mm-dd, identifiers and invalid/empty cells retain their values',async()=>{
  const columns=['PND','FAT','작업지시일','실제 완료일','Hull No.','Work Order','제품 규격','현공정','수량'];
  for(const date1904 of [false,true]){
    const source=new ExcelJS.Workbook();source.properties.date1904=date1904;const sheet=source.addWorksheet('Sheet1');sheet.addRow(columns);
    sheet.addRow([new Date('2026-10-31T00:00:00Z'),new Date('2026-11-01T00:00:00Z'),'2026/10/30','2026-11-02','000007','000019','0008-A','조립',3]);
    sheet.addRow(['2026-10-29','미정','','날짜 확인 중','000008','000020','0009-B','납품준비',2]);
    const bytes=new Uint8Array(await source.xlsx.writeBuffer()),raw=readTable(bytes,'production',{preserveText:true}),original=Buffer.from(bytes);
    const exported=productionWorkbook(columns,[raw.row(2),raw.row(3)],{date1904:raw.date1904}),book=new ExcelJS.Workbook();await book.xlsx.load(exported);const out=book.worksheets[0];
    for(const [cell,day]of [['A2','2026-10-31'],['B2','2026-11-01'],['C2','2026-10-30'],['D2','2026-11-02'],['A3','2026-10-29']]){assert(out.getCell(cell).value instanceof Date,cell);assert.equal(out.getCell(cell).value.toISOString().slice(0,10),day);assert.equal(out.getCell(cell).numFmt,'yyyy-mm-dd');}
    assert.equal(out.getCell('B3').value,'미정');assert.equal(out.getCell('D3').value,'날짜 확인 중');assert(['',null].includes(out.getCell('C3').value));
    assert.equal(out.getCell('E2').value,'000007');assert.equal(out.getCell('F2').value,'000019');assert.equal(out.getCell('G2').value,'0008-A');assert.equal(out.getCell('I2').value,3);
    assert.deepEqual([out.getCell('A2').value,out.getCell('A3').value].sort((a,b)=>a-b).map(d=>d.toISOString().slice(0,10)),['2026-10-29','2026-10-31']);assert.deepEqual(Buffer.from(bytes),original);
  }
});
test('1904 zero serial is a real date; empty, invalid serials and numeric strings are never coerced',async()=>{
  const bytes=productionWorkbook(['PND','FAT','Work Order'],[[0,'','00000'],['46318','2026-02-30',17]],{date1904:true}),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const s=book.worksheets[0];assert.equal(s.getCell('A2').value.toISOString().slice(0,10),'1904-01-01');assert(['',null].includes(s.getCell('B2').value));assert.equal(s.getCell('A3').value,'46318');assert.equal(s.getCell('B3').value,'2026-02-30');assert.equal(s.getCell('C3').value,'17');
});
