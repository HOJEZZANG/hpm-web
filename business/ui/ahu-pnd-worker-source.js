import {openAhuWorkbook} from '../ahu-workbook.mjs';
import {extractAhuRows} from '../ahu-xlsx.mjs';
import {comparePnd,exportRows,exportColumns} from '../ahu-pnd.mjs';
import {writeTable} from '../ooxml.mjs';
const sources={};let results=[];
self.onmessage=({data:m})=>{try{
  let result;
  if(m.type==='load'){delete sources[m.side];results=[];const workbook=openAhuWorkbook(new Uint8Array(m.bytes),m.file);sources[m.side]={workbook,file:m.file};result={sheets:workbook.sheets,format:workbook.format,notices:workbook.notices||[]};}
  else if(m.type==='sheet'){const source=sources[m.side];source.sheet=source.workbook.readSheet(m.index);results=[];result=source.sheet.preview;}
  else if(m.type==='compare'){results=comparePnd(extractAhuRows(sources.erp.sheet,m.erp,sources.erp.file),extractAhuRows(sources.plan.sheet,m.plan,sources.plan.file),m.aliases);result=results;}
  else if(m.type==='export'){const ids=m.ids?new Set(m.ids):null,rows=ids?results.filter(r=>ids.has(r.id)):results;const bytes=writeTable(exportColumns,exportRows(rows),'AHU PND 대조');self.postMessage({id:m.id,result:{bytes:bytes.buffer,count:rows.length}},[bytes.buffer]);return;}
  else throw Error('지원하지 않는 작업입니다.');self.postMessage({id:m.id,result});
}catch(error){self.postMessage({id:m.id,error:error.message});}};
