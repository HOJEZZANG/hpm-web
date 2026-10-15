import {Unzip,UnzipInflate} from 'fflate';
import {readTable,writeTable} from './ooxml.mjs';
import {ensure,date,dateColumns,productionColumns,supplyColumns} from './domain.mjs';
export const MAX_FILE=2*1024*1024, MAX_ROWS=500;
export const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Inspect ZIP directory before decompression. Do not accept macros, encrypted files or ZIP bombs.
export function inspectZip(bytes) {
  ensure(bytes.length>22 && bytes.length<=MAX_FILE, '엑셀 파일은 2MB 이하이어야 합니다.',413);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  ensure(end>=0,'정상적인 .xlsx 파일이 아닙니다. .xls는 .xlsx로 저장하세요.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  ensure(count>0&&count<=200&&offset+size<=end,'엑셀 ZIP 구조 또는 항목 수를 확인하세요.');
  let pos=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++){
    ensure(pos+46<=end&&view.getUint32(pos,true)===0x02014b50,'엑셀 ZIP 목록이 손상되었습니다.');
    const length=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
    ensure(!(view.getUint16(pos+8,true)&1),'암호화된 엑셀은 지원하지 않습니다.');
    total+=view.getUint32(pos+24,true);ensure(total<=12*1024*1024,'압축 해제한 엑셀은 12MB 이하이어야 합니다.',413);
    ensure(pos+46+length+extra+comment<=end,'엑셀 ZIP 구조를 확인하세요.');
    const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+length));
    ensure(!names.has(name)&&!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\')&&!/(^|\/)(__proto__|prototype|constructor)(\/|$)/.test(name)&&!/vbaProject|externalLinks|embeddings/i.test(name),'중복 ZIP 항목, 매크로, 외부 연결 및 삽입 객체는 지원하지 않습니다.');names.add(name);
    pos+=46+length+extra+comment;
  }
  ensure(names.has('[Content_Types].xml')&&names.has('xl/workbook.xml'),'엑셀 통합문서가 아닙니다.');
  // Check actual streamed expansion too; do not trust sizes declared in a forged directory.
  let expanded=0,actualFiles=0,complete=0;
  const unzip=new Unzip(file=>{
    actualFiles++;ensure(actualFiles<=200&&names.has(file.name),'엑셀 ZIP 파일 목록이 일치하지 않습니다.');
    file.ondata=(error,data,final)=>{if(error?.status)throw error;ensure(!error,'엑셀 압축 데이터가 손상되었습니다.');expanded+=data.length;ensure(expanded<=12*1024*1024,'압축 해제 용량은 12MB 이하이어야 합니다.',413);if(final)complete++;};file.start();
  });unzip.register(UnzipInflate);
  try{for(let i=0;i<bytes.length;i+=1024)unzip.push(bytes.subarray(i,Math.min(i+1024,bytes.length)),i+1024>=bytes.length);}catch(e){if(e.status)throw e;ensure(false,'엑셀 압축 구조를 확인하세요.');}
  ensure(actualFiles===count&&complete===count,'엑셀 ZIP 항목이 누락되었거나 손상되었습니다.');
}
function excelDate(v,label,date1904){
  if(v==='')return '';
  if(typeof v==='number'){
    ensure(Number.isInteger(v)&&(date1904?v>=0:v>0)&&v<2958000&&!(v===60&&!date1904),`${label}: 엑셀 날짜를 확인하세요.`);
    const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31);
    return date(new Date(base+(v-(date1904?0:v>60?1:0))*86400000).toISOString().slice(0,10),label);
  }
  return date(String(v).replaceAll('/','-').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`),label);
}
export async function parseWorkbook(bytes,kind){
  inspectZip(bytes);const sheet=readTable(bytes,kind);
  let head=1;
  if(kind==='supplies'){
    head=[1,2,3,4,5].find(i=>sheet.row(i).some(v=>String(v).trim()==='품목코드'));
    ensure(head,'앞쪽 5행 안에 품목코드 머리글이 필요합니다.');
  }
  const headers=sheet.row(head).map(v=>String(v).trim().replace(/^폼목명$/,'품목명'));
  ensure(headers.length&&headers.every(Boolean)&&new Set(headers).size===headers.length,'빈 머리글·중복 머리글은 허용하지 않습니다.');
  const allowed=kind==='production'?productionColumns:supplyColumns;
  ensure(headers.every(h=>allowed.includes(h)),'지원하지 않는 열: '+headers.filter(h=>!allowed.includes(h)).join(', ')+'. 양식의 열을 사용하세요.');
  const required=kind==='production'?['PND','현공정','수량']:['품목코드','품목명','규격','단위','단가'];
  ensure(required.every(h=>headers.includes(h)),'필수 열: '+required.join(', '));
  if(kind==='production')ensure(['제조사양관리구분','분류','LINE 5000'].some(h=>headers.includes(h)),'장비 구분 열(제조사양관리구분/분류/LINE 5000)이 필요합니다.');
  const rows=[],codes=new Set(),warnings=[];
  for(let r=head+1;r<=sheet.maxRow;r++){
    const row={};for(let c=0;c<headers.length;c++)row[headers[c]]=sheet.get(r,c+1);
    if(Object.values(row).every(v=>v===''))continue;
    ensure(rows.length<MAX_ROWS,`데이터는 최대 ${MAX_ROWS}행까지 허용합니다.`);
    for(const h of headers){
      if(kind==='production'&&dateColumns.includes(h))row[h]=excelDate(row[h],`${r}행 ${h}`,sheet.date1904);
      else if((kind==='production'&&h==='수량')||(kind==='supplies'&&h==='단가')){
        const n=Number(row[h]);ensure(row[h]!==''&&Number.isFinite(n)&&n>=0&&n<=1000000000&&Number.isInteger(n),`${r}행 ${h}: 0~10억 정수를 입력하세요.`);row[h]=n;
      }else row[h]=String(row[h]);
    }
    if(kind==='supplies'){
      ensure(row['품목코드']&&row['품목명']&&row['단위'],`${r}행: 품목코드·품목명·단위가 필요합니다.`);
      ensure(!codes.has(row['품목코드']),`${r}행: 파일 내 품목코드가 중복됩니다. 모호한 품목은 자동 병합하지 않습니다.`);codes.add(row['품목코드']);
      row['모델번호']||='';row['규격']||='-';
    }else if(!row.PND)warnings.push(`${r}행: PND가 비어 있어 지연·임박 집계에서 제외됩니다.`);
    rows.push({number:r,data:row});
  }
  ensure(rows.length,'등록할 데이터 행이 없습니다.');
  return {headers,rows,warnings};
}
export async function createWorkbook(columns,rows,sheetName='Sheet1'){
  return writeTable(columns,rows,sheetName);
}
export async function template(kind){
  return createWorkbook(kind==='production'?productionColumns:supplyColumns,kind==='production'?[{PND:'2026-12-31','제조사양관리구분':'CHILLER',Yard:'예시조선소',HullNo:'EXAMPLE-001','현공정':'조립','작업장':'예시작업장','수량':1,'Work Order':'예시-001'}]:[{'품목코드':'EXAMPLE-001','품목명':'예시 장갑','규격':'L','단위':'EA','단가':1000,'모델번호':'예시모델'}]);
}
