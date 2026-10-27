// Entirely synthetic fixtures, generated in memory. No company files or operational records.
import ExcelJS from 'exceljs';
import {read,write} from 'xlsx';
export async function ahuFixture(side,format='xlsx'){
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('가상 안내').addRow(['실제 회사 자료 아님: AHU PND 기능 검증용 가상 자료']);
  const sheet=workbook.addWorksheet(side==='erp'?'가상 ERP 자료':'가상 계획 자료'),header=side==='erp'?3:2;
  sheet.getCell('A1').value='기능 검증용 가상 자료 — 실제 ERP/생산계획표 아님';
  sheet.getRow(header).values=['가상 제품 구분','가상 야드 명칭','가상 호선','가상 PND','가상 메모'];
  const base=[['00100','2026-11-10'],['00101',side==='erp'?'2026-11-10':'2026-11-05'],['00102',side==='erp'?'2026-11-10':'2026-11-01'],['00103',side==='erp'?'2026-11-10':'2026-11-13'],['00104',side==='erp'?'':'2026-11-11'],['00105',side==='erp'?'2026-02-30':'2026-11-11'],['00107','2026-11-10'],['00108','2026-11-10'],['H-00A','2026-11-10']];
  for(const [hull,pnd]of base)sheet.addRow(['가상 AHU','가상 YARD-A',hull,pnd,'가상 검증']);
  sheet.addRow(['가상 AHU','가상 YARD-A',side==='erp'?'00106':'00999','2026-11-10','한쪽 파일만']);
  sheet.addRow(['가상 AHU','가상 YARD-A',side==='erp'?'00107':'00108','2026-11-12','가상 중복']);
  const formatted=sheet.addRow(['가상 AHU','가상 YARD-A',side==='erp'?123:'00123','2026-11-10','앞자리 0 표시 서식']);if(side==='erp')formatted.getCell(3).numFmt='00000';
  sheet.addRow(['가상 AHU',side==='erp'?'가상 정식 야드':'가상 별칭 야드','00077','2026-11-10','사용자가 확인할 별칭']);
  if(side==='erp')sheet.addRow(['가상 AHU','가상 YARD-A','','2026-11-10','호선 누락']);
  sheet.addRow(['가상 CHILLER','가상 YARD-A','00100','2026-12-31','AHU 아님: 사용자가 제외']);
  sheet.getCell( header,6).value='가상 규격/품번';for(let r=header+1;r<=sheet.rowCount;r++)sheet.getCell(r,6).value=side==='erp'?'HKA008SN/SYNTH-'+r:'HKA-08SN';
  const xlsx=new Uint8Array(await workbook.xlsx.writeBuffer());
  // Only synthetic fixtures are serialized into both real formats. Application inputs are never converted.
  const bytes=format==='xls'?new Uint8Array(write(read(xlsx,{type:'array',cellNF:true}),{type:'array',bookType:'biff8'})):xlsx;
  return {bytes,header,sheetIndex:1,filename:(side==='erp'?'가상_ERP.':'가상_생산계획.')+format};
}
export async function ahuPresetFixture(side,format='xlsx',change=()=>{}){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(side==='erp'?'Sheet1':'ALL'),header=side==='erp'?2:6;
  sheet.getCell('A1').value=side==='erp'?'가상 ERP 프리셋 검사':'Air Handling Unit 생산 Sch.';
  if(side==='erp'){
    for(const [c,title]of [[4,'Yard'],[5,'HullNo'],[8,'PND'],[10,'품번'],[20,'LINE 5000'],[23,'제조사양관리구분']])sheet.getCell(header,c).value=title;
    for(const [i,hull]of ['0001','0002','0003','0004','0005'].entries()){const r=header+i+1;for(const [c,value]of [[4,'가상 ERP 야드'],[5,hull],[8,'2026-11-10'],[10,'HKA008SN/SYNTH-'+i],[20,i===3?'CHILLER':i===4?'AHU (특수선)':'AHU'],[23,i===1||i===3?'':i===2?'OFFSHORE AHU':'AHU']])sheet.getCell(r,c).value=value;}
  }else{
    for(const [c,title]of [[1,'NO.'],[2,'YARD'],[3,'호선'],[6,'규격'],[16,'PND']])sheet.getCell(header,c).value=title;
    for(const [i,hull]of ['0001','0002','0005'].entries()){const r=header+i+1;for(const [c,value]of [[1,i+1],[2,'가상 계획 야드'],[3,hull],[6,'HKA-08SN'],[16,i===0?'2026-11-05':i===1?'2026-11-13':'2026-11-10']])sheet.getCell(r,c).value=value;}
  }
  change(sheet,book);const xlsx=new Uint8Array(await book.xlsx.writeBuffer()),bytes=format==='xls'?new Uint8Array(write(read(xlsx,{type:'array',cellNF:true}),{type:'array',bookType:'biff8'})):xlsx;
  return {bytes,filename:'가상_기본프리셋_'+side+'.'+format,header,sheetIndex:0};
}
