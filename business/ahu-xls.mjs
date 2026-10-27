// Read genuine BIFF5/8 XLS bytes in the browser worker, without conversion or formula evaluation.
import {CFB,read,set_cptable,SSF,utils} from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import {AHU_LIMITS as L,calendarDate} from './ahu-pnd.mjs';
import {formattedNumber} from './ahu-cells.mjs';
set_cptable(cptable);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};

function inspectBiff(bytes){
  requireValue(bytes.length>=8,'.xls 통합문서 스트림이 손상되었습니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),version=view.getUint16(4,true);
  requireValue(view.getUint16(0,true)===0x0809&&[0x0500,0x0600].includes(version)&&view.getUint16(6,true)===5,'Excel 95/97-2003 BIFF .xls 통합문서만 지원합니다.');
  let offset=0,depth=0,ended=false,external=false;
  while(offset<bytes.length){
    if(ended&&bytes.subarray(offset).every(n=>n===0))break;
    requireValue(offset+4<=bytes.length,'.xls 레코드 헤더가 손상되었습니다.');
    const id=view.getUint16(offset,true),size=view.getUint16(offset+2,true),start=offset+4,end=start+size;
    requireValue(end<=bytes.length,'.xls 레코드가 잘렸습니다.');
    if(id===0x0809){requireValue(size>=4,'.xls BOF 레코드가 손상되었습니다.');depth++;requireValue(![0x0040,0x0006].includes(view.getUint16(start+2,true)),'.xls 매크로 시트는 지원하지 않습니다.');}
    if(id===0x000a){requireValue(size===0&&depth>0,'.xls EOF 레코드가 손상되었습니다.');depth--;ended=true;}
    requireValue(id!==0x002f,'암호화된 .xls 파일은 지원하지 않습니다.');
    if(id===0x0085){requireValue(size>=7,'.xls 시트 정보가 손상되었습니다.');requireValue(![1,6].includes(bytes[start+5]),'.xls 매크로 시트는 지원하지 않습니다.');}
    if(id===0x01ae){requireValue(size>=4,'.xls 외부 참조 정보가 손상되었습니다.');if(view.getUint16(start+2,true)!==0x0401)external=true;}
    if([0x0051,0x00dc,0x01ad].includes(id)||version===0x0500&&id===0x0017)external=true;
    offset=end;
  }
  requireValue(depth===0&&ended,'.xls 통합문서가 완결되지 않았습니다.');
  return external?['외부 참조 포함: 외부 파일·연결을 열거나 갱신하지 않고 통합문서에 저장된 셀 값만 읽었습니다.']:[];
}

export function openAhuXls(bytes){
  requireValue(bytes.length>0&&bytes.length<=L.file,'엑셀 파일은 10MiB 이하이어야 합니다.');
  let cfb;try{cfb=CFB.read(bytes,{type:'array'});}catch{throw Error('.xls 컨테이너가 손상되었거나 지원하지 않는 형식입니다.');}
  requireValue(cfb.FileIndex.length<=200,'.xls 내부 항목 200개 한계를 초과했습니다.');
  let total=0;const names=new Set();
  for(const [i,entry]of cfb.FileIndex.entries()){
    if(!entry.type)continue;const name=cfb.FullPaths[i];
    requireValue(!names.has(name),'.xls 내부 항목이 중복되었습니다.');names.add(name);
    requireValue(!/VBA|_VBA_PROJECT|Macros/i.test(name),'.xls 매크로는 지원하지 않습니다.');
    requireValue(!/EncryptedPackage|EncryptionInfo|\/encryption$/i.test(name),'암호화된 .xls 파일은 지원하지 않습니다.');
    requireValue(!/ObjectPool|Ole10Native|\/MBD/i.test(name),'.xls 삽입 객체는 지원하지 않습니다.');
    if(entry.type===2){total+=entry.size;requireValue(total<=L.expanded,'.xls 내부 데이터 32MiB 한계를 초과했습니다.');}
  }
  const workbook=CFB.find(cfb,'/Workbook')||CFB.find(cfb,'/Book');
  requireValue(workbook?.content,'정상적인 BIFF .xls 통합문서가 아닙니다.');const notices=inspectBiff(new Uint8Array(workbook.content));
  const options={cellNF:true,cellFormula:true,cellHTML:false,cellText:false,cellDates:false,sheetStubs:true,WTF:true};
  function parse(extra){try{return read(bytes,{type:'array',...options,...extra});}catch{throw Error('.xls 데이터를 완전하게 읽을 수 없습니다. 손상·미지원 형식을 확인하세요.');}}
  const meta=parse({bookSheets:true}),sheets=meta.SheetNames;
  requireValue(sheets?.length>0&&new Set(sheets).size===sheets.length,'.xls 시트 이름이 없거나 중복되었습니다.');
  function readSheet(index){
    requireValue(Number.isInteger(index)&&sheets[index],'시트를 선택하세요.');
    const book=parse({sheets:index}),sheet=book.Sheets[sheets[index]],date1904=Boolean(book.Workbook?.WBProps?.date1904);
    requireValue(sheet&&!sheet['!type'],'일반 워크시트만 비교할 수 있습니다.');
    const byRow=new Map(),used=new Set();let count=0,textSize=0;
    for(const [address,cell]of Object.entries(sheet)){
      if(address.startsWith('!'))continue;
      const formula=typeof cell.f==='string'||Boolean(cell.F);let value=cell.v??'',issue='';
      if(!['n','s','str','z'].includes(cell.t))issue='오류 또는 지원하지 않는 셀 형식';
      if(formula&&value==='')issue='수식의 저장된 계산값 없음/빈 값 (수식은 실행하지 않음)';
      if(value===''&&!formula&&!issue)continue;
      requireValue(/^[A-Z]+[1-9]\d*$/.test(address),'.xls 셀 위치를 확인하세요.');const pos=utils.decode_cell(address),number=pos.r+1,column=pos.c+1;
      requireValue(number<=65536&&column<=256,'.xls 셀 위치 범위를 벗어났습니다.');
      if(typeof value==='number')requireValue(Number.isFinite(value),'.xls 숫자 셀 오류입니다.');
      const formatted=typeof value==='number'?formattedNumber(String(value),cell.z):{display:String(value)};
      const display=typeof value==='number'&&SSF.is_date(cell.z||'General')?(calendarDate(value,date1904).iso||String(value)):formatted.display;
      requireValue(display.length<=32767,'셀 텍스트는 32,767자 이내이어야 합니다.');
      count++;textSize+=display.length*2;requireValue(count<=L.cells&&textSize<=L.text,'유효 셀 250,000개 또는 텍스트 16MiB 한계를 초과했습니다. 자료를 나누세요.');
      if(!byRow.has(number)){byRow.set(number,{number,cells:new Map()});requireValue(byRow.size<=L.rows,'시트의 유효 행 20,000개 한계를 초과했습니다. 자료를 나누세요.');}
      byRow.get(number).cells.set(column,{value,display,issue,keyIssue:issue||formatted.keyIssue||'',formula});used.add(column);
      requireValue(used.size<=L.columns,'사용 열 256개 한계를 초과했습니다.');
    }
    const rows=[...byRow.values()].sort((a,b)=>a.number-b.number),columns=[...used].sort((a,b)=>a-b);
    return {name:sheets[index],date1904,rows,columns,notices,preview:{columns,rows:rows.map(r=>({number:r.number,values:columns.map(c=>r.cells.get(c)?.display||'')})),cellCount:count}};
  }
  return {sheets,readSheet,notices};
}
