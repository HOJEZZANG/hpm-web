import {writeTable} from './ooxml.mjs';
import {excelDate} from './excel.mjs';
import {dateColumns,isProductionCompletionTitle} from './domain.mjs';
import {pndDate} from './weekly-data.mjs';
const clean=v=>String(v??'').replace(/\s/g,'');
export const isProductionDateTitle=value=>dateColumns.map(clean).includes(clean(value))||isProductionCompletionTitle(value)||/(?:완료|예정|요청|접수|지시|납품|착수|납기)일(?:자)?$/.test(clean(value));
const identifier=value=>/^(?:HULLNO\.?|WORKORDER|제품(?:NO\.?|규격|번호)|규격|초기호선)$/.test(clean(value).toUpperCase());
export function productionWorkbook(columns,rows,{date1904=false}={}){
  const converted=rows.map(r=>columns.map((column,i)=>{
    const title=typeof column==='string'?column:column.title,value=Array.isArray(r)?r[i]:r[typeof column==='string'?column:column.id]??'';
    if(value===''||value==null)return '';
    if(identifier(title))return String(value);
    if(!isProductionDateTitle(title))return value;
    let day='';try{day=typeof value==='number'?excelDate(value,title,date1904):pndDate(value);}catch{ /* Keep unparseable original cells. */ }
    if(!day)return value;
    const stamp=Date.parse(day+'T00:00:00Z'),serial=(stamp-Date.UTC(1899,11,31))/86400000+(day>='1900-03-01'?1:0);
    return {type:'date',serial};
  }));
  return writeTable(columns,converted);
}
