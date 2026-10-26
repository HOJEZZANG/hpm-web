// Entirely synthetic fixtures, generated in memory. No company files or operational records.
import ExcelJS from 'exceljs';
export async function ahuFixture(side){
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
  return {bytes:new Uint8Array(await workbook.xlsx.writeBuffer()),header,sheetIndex:1,filename:side==='erp'?'가상_ERP.xlsx':'가상_생산계획.xlsx'};
}
