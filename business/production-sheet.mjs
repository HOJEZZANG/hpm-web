import {ensure,productionColumns,dateColumns,isProductionCompletionTitle} from './domain.mjs';
import {readTable} from './ooxml.mjs';
import {inspectZip,excelDate} from './excel.mjs';
import {productionLimits as L,byteLength} from './production-limits.mjs';
export const columnLabel=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export const normalizedTitle=v=>String(v??'').trim();
export function mappingInfo(columns){
  const mapping={},candidates={};
  for(const field of productionColumns){const matches=columns.filter(c=>field==='실제완료일'?isProductionCompletionTitle(c.title):normalizedTitle(c.title)===field);if(matches.length)candidates[field]=matches.map(c=>c.id);if(matches.length===1)mapping[field]=matches[0].id;}
  const equipment=['제조사양관리구분','분류','LINE 5000'].find(k=>candidates[k]);
  const required=['PND','현공정','수량',...(equipment?[equipment]:[])];
  return {mapping,candidates,equipment,required,missing:[...required.filter(k=>!candidates[k]),...(!equipment?['장비 구분 (제조사양관리구분/분류/LINE 5000)']:[])]};
}
export function validateMetadata(meta){
  ensure(meta&&Array.isArray(meta.columns)&&meta.columns.length&&byteLength(meta)<=L.metadata,'열 정보는 512KiB 처리 예산 이내이어야 합니다.',413);
  let previous=0;for(const c of meta.columns){ensure(c&&Number.isInteger(c.position)&&c.position>previous&&c.position<=L.excelColumns&&c.id==='c'+c.position&&typeof c.title==='string'&&c.title.length<=32767,'열 위치/내부 식별자를 확인하세요.');previous=c.position;}
  const info=mappingInfo(meta.columns);ensure(!info.missing.length,'필수 열 누락: '+info.missing.join(', '));
  ensure(meta.equipment===info.equipment,'장비 구분 열 정보가 올바르지 않습니다.');
  ensure(meta.mapping&&typeof meta.mapping==='object'&&!Array.isArray(meta.mapping),'업무 열 선택이 필요합니다.');
  for(const [field,id]of Object.entries(meta.mapping))ensure(productionColumns.includes(field)&&info.candidates[field]?.includes(id),'업무 열 선택이 올바르지 않습니다: '+field);
  for(const field of info.required)ensure(meta.mapping[field],'중복된 필수 업무 열을 선택하세요: '+field);
  ensure(typeof meta.date1904==='boolean'&&Number.isInteger(meta.rowCount)&&meta.rowCount>0&&meta.rowCount<L.excelRows,'데이터 행 정보를 확인하세요.');return info;
}
export function normalizeProductionRow(raw,meta){
  ensure(raw&&Number.isInteger(raw.number)&&raw.number>1&&raw.number<=L.excelRows&&Array.isArray(raw.values)&&raw.values.length===meta.columns.length,'행 위치/열 개수를 확인하세요.');
  ensure(raw.values.every(v=>typeof v==='string'&&v.length<=32767||typeof v==='number'&&Number.isFinite(v)),'셀 값은 문자열/유한 숫자만 허용합니다.');
  ensure(raw.values.some(v=>v!==''),'빈 데이터 행은 반영하지 않습니다.');
  if(raw.formulas)ensure(Array.isArray(raw.formulas)&&raw.formulas.every(f=>Array.isArray(f)&&Number.isInteger(f[0])&&f[0]>=0&&f[0]<meta.columns.length&&typeof f[1]==='string'&&f[1].length<=32767),'수식 원본 정보가 올바르지 않습니다.');
  ensure(byteLength(raw)<=L.row,'한 행의 원본 데이터는 128KiB 이내이어야 합니다. 파일의 긴 텍스트를 분리해 주세요.',413);
  const data={};for(const [field,id]of Object.entries(meta.mapping)){
    const c=meta.columns.findIndex(c=>c.id===id),value=raw.values[c];
    if(field==='실제완료일'){try{data[field]=excelDate(typeof value==='string'?value.trim():value,raw.number+'행 '+field,meta.date1904);}catch{data[field]=String(value);}}
    else if(dateColumns.includes(field))data[field]=excelDate(typeof value==='string'?value.trim():value,raw.number+'행 '+field,meta.date1904);
    else if(field==='수량'){const n=Number(value);ensure(String(value).trim()!==''&&Number.isInteger(n)&&n>=0&&n<=1e9,raw.number+'행 수량: 0~10억 정수를 입력하세요. 수식은 저장된 계산값이 필요합니다.');data[field]=n;}
    else {ensure(String(value).length<=2000,raw.number+'행 '+field+': 업무 값은 2,000자 이내로 입력하세요.');data[field]=String(value).trim();}
  }
  return {...data,__cells:raw.values,...(raw.formulas?.length?{__formulas:raw.formulas}:{}),__cellCount:raw.values.filter(v=>v!=='').length};
}
export function parseProductionSheet(bytes,onProgress=()=>{}){
  inspectZip(bytes,{file:L.file,expanded:L.expanded});onProgress({phase:'파싱',percent:20});
  const sheet=readTable(bytes,'production',{preserveText:true,cachedFormulas:true});onProgress({phase:'행·열 구분',percent:70});
  const columns=sheet.usedColumns.map(position=>({id:'c'+position,position,title:String(sheet.get(1,position))}));
  const info=mappingInfo(columns);ensure(!info.missing.length,'필수 열 누락: '+info.missing.join(', '));
  const rows=sheet.rowNumbers.filter(n=>n>1).map(number=>({number,values:columns.map(c=>sheet.get(number,c.position)),formulas:columns.flatMap((c,i)=>sheet.formula(number,c.position)?[[i,sheet.formula(number,c.position)]]:[])}));
  ensure(rows.length,'등록할 데이터 행이 없습니다.');const meta={version:2,columns,mapping:info.mapping,date1904:sheet.date1904,rowCount:rows.length,equipment:info.equipment};ensure(byteLength(meta)<=L.metadata,'열 정보 처리 예산 512KiB를 초과했습니다.',413);
  return {meta,info,rows};
}
