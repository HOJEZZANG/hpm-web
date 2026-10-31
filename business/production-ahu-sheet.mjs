// The verified comparison reader is reused without changing the PND comparison.
import {openAhuWorkbook} from './ahu-xlsx.mjs';
import {ensure} from './domain.mjs';
import {excelDate} from './excel.mjs';
import {productionLimits as L,byteLength} from './production-limits.mjs';
import {assertPartRow} from './production-parts.mjs';
export const ahuFields=['Yard','HullNo','현공정','PND','수량','품번','Work Order','LINE 5000','규격','최종완료일','최신공정완료일'];
const ids=new Set(['HullNo','품번','Work Order','규격','초기호선','프로젝트번호','생산계획번호','TagNo','SysNo']);
const title=v=>String(v??'').trim();
export function ahuMapping(columns){
 const mapping={};for(const name of ahuFields){const matches=columns.filter(c=>title(c.title)===name);ensure(matches.length===1,'2파트(AHU) 필수 열 확인: '+name);mapping[name]=matches[0].id;}
 return mapping;
}
export function validateAhuMetadata(meta){
 ensure(meta.part==='part2'&&meta.sourceSheet==='Sheet1'&&Number.isInteger(meta.headerRow)&&meta.headerRow>=1&&meta.headerRow<=10,'2파트(AHU) 시트·헤더 정보를 확인하세요.');
 const mapping=ahuMapping(meta.columns);ensure(JSON.stringify(mapping)===JSON.stringify(meta.mapping)&&meta.equipment==='LINE 5000','2파트(AHU) 열 제목과 기본 매핑이 다릅니다.');
 return {mapping,candidates:Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k,[v]])),required:ahuFields,equipment:'LINE 5000'};
}
export function normalizeAhuRow(raw,meta){
 const data={};for(const [field,id]of Object.entries(meta.mapping)){const value=raw.values[meta.columns.findIndex(c=>c.id===id)];
  if(field==='수량'){ensure(String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=1e9,raw.number+'행 수량을 확인하세요.');data[field]=Number(value);}
  else if(['PND','최종완료일','최신공정완료일'].includes(field)){try{data[field]=excelDate(typeof value==='string'?value.trim():value,field,meta.date1904);}catch{data[field]=String(value);}}
  else data[field]=String(value).trim();
 }
 ensure(['Yard','HullNo','품번','Work Order','규격'].every(k=>data[k]),raw.number+'행 야드·호선·품번·작업지시·규격을 확인하세요.');assertPartRow(data,'part2');
 return {...data,__cells:raw.values,__cellCount:raw.values.filter(v=>v!=='').length};
}
export function parseAhuProductionSheet(bytes,onProgress=()=>{}){
 const book=openAhuWorkbook(bytes);ensure(book.sheets.includes('Sheet1'),'2파트(AHU)는 Sheet1 양식을 사용하세요.');
 // Only the verified primary sheet is counted. Additional sheets are never combined.
 const sheet=book.readSheet(book.sheets.indexOf('Sheet1'));onProgress({phase:'AHU 양식 확인',percent:55});
 const headers=sheet.rows.filter(r=>r.number<=10&&ahuFields.every(k=>[...r.cells.values()].some(c=>title(c.display)===k)));
 ensure(headers.length>=1,'2파트(AHU) 헤더를 확인하세요. 제공된 AHU 양식을 사용하세요.');const header=headers[0];
 ensure(headers.every(r=>sheet.columns.every(c=>title(r.cells.get(c)?.display)===title(header.cells.get(c)?.display))),'서로 다른 AHU 헤더가 있습니다. 양식을 확인하세요.');
 const columns=sheet.columns.map(position=>({id:'c'+position,position,title:header.cells.get(position)?.display||''})),mapping=ahuMapping(columns);
 const at=(r,k)=>r.cells.get(columns.find(c=>c.id===mapping[k]).position);
 const rows=[],excluded={blank:0,headers:0,summary:0};
 for(const r of sheet.rows.filter(r=>r.number>header.number)){
  const labels=[...r.cells.values()].map(c=>title(c.display)).filter(Boolean);
  if(!labels.length){excluded.blank++;continue;}
  if(ahuFields.every(k=>title(at(r,k)?.display)===k)){excluded.headers++;continue;}
  if(!['Yard','HullNo','품번','Work Order','규격'].every(k=>title(at(r,k)?.display))&&labels.some(v=>/^(?:합계|소계|총계|총\s*합계|subtotal|grand\s*total|total)(?:\s*[:：]?\s*[\d,.]+)?$/i.test(v))){excluded.summary++;continue;}
  const values=columns.map(c=>{const cell=r.cells.get(c.position);ensure(!cell?.issue,r.number+'행 '+(c.title||c.id)+': '+cell?.issue);if(ids.has(c.title)){ensure(!cell?.keyIssue,r.number+'행 식별값 표시 형식을 확인하세요: '+c.title);return cell?.display??'';}return cell?.value??'';});
  rows.push({number:r.number,values});
 }
 ensure(rows.length,'2파트(AHU) 대상 행이 없습니다.');
 const meta={version:2,part:'part2',sourceSheet:'Sheet1',headerRow:header.number,columns,mapping,equipment:'LINE 5000',date1904:sheet.date1904,rowCount:rows.length,excluded};
 ensure(byteLength(meta)<=L.metadata,'AHU 열 정보 처리 한계를 초과했습니다.',413);for(const raw of rows)normalizeAhuRow(raw,meta);
 return {meta,info:validateAhuMetadata(meta),rows};
}
