import {parseProductionSheet,validateMetadata,normalizeProductionRow} from '../production-sheet.mjs';
import {productionLimits as L,byteLength} from '../production-limits.mjs';
import {ensure} from '../domain.mjs';
import {productionWorkbook} from '../production-export.mjs';
import {productionView,ahuView} from '../production-view.mjs';
import {productionDisplay} from './production-display.js';
let plan;
self.onmessage=async({data:m})=>{try{
  let result;
  if(m.type==='parse'){
    plan=parseProductionSheet(new Uint8Array(m.bytes),progress=>self.postMessage({progress}),m.part);
    result={meta:plan.meta,info:plan.info,sample:plan.rows.slice(0,20)};
  }else if(m.type==='validate'){
    plan.meta.mapping=m.mapping;validateMetadata(plan.meta);let size=0,cells=0,warnings=0;
    for(const row of plan.rows){const d=normalizeProductionRow(row,plan.meta);size+=byteLength(d);cells+=d.__cellCount;if(!d.PND)warnings++;}
    ensure(size<=L.staged&&cells<=L.cells,'유효 셀/해석 데이터 처리 예산을 초과했습니다.',413);result={meta:plan.meta,warnings,bytes:size,cells};
  }else if(m.type==='chunk'){
    const rows=[];let bytes=32;for(const row of plan.rows.slice(m.offset,m.offset+L.chunkRows)){const size=byteLength(row)+1;if(rows.length&&bytes+size>L.chunk)break;rows.push(row);bytes+=size;}result={rows,next:m.offset+rows.length,total:plan.rows.length};
  }else if(m.type==='view'){
    result=m.part==='part2'?ahuView(m.records,m.filters,m.selection,m.today):productionView(m.records,m.filters,m.equipment,m.selection,m.today);
    result.display=productionDisplay(result,m.part,m.equipment);
  }else if(m.type==='export'){const bytes=productionWorkbook(m.columns,m.rows,{date1904:m.date1904});self.postMessage({id:m.id,result:{bytes:bytes.buffer}},[bytes.buffer]);return;}
  else throw Error('지원하지 않는 처리입니다.');self.postMessage({id:m.id,result});
}catch(e){self.postMessage({id:m.id,error:e.message});}};
