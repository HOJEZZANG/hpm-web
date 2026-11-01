// Production final-completion evidence only. Issue handling dates are never inputs.
import {isProductionCompletionTitle} from '../domain.mjs';
import {productionProcessState,ahuProcessState} from '../production-view.mjs';
import {calendarDate} from '../ahu-pnd.mjs';
import {esc,table,button} from './common.js';
export function productionAdherence(records,{part,meta,allRecords=records}={}){
  const field=part==='part2'?'최종완료일':'실제완료일',column=meta?.columns?.find(c=>c.id===meta.mapping?.[field]&&isProductionCompletionTitle(c.title)),pndColumn=meta?.columns?.find(c=>c.id===meta.mapping?.PND&&c.title.trim()==='PND');
  const source=column&&pndColumn&&(!meta.part||meta.part===part)?{field,title:column.title,position:column.position,pndTitle:pndColumn.title,pndPosition:pndColumn.position}:null;
  const hasActual=Boolean(source&&allRecords.some(r=>String(r[field]??'').trim())),onTime=[],late=[],excluded=[];
  for(const record of records){
    const reasons=[],state=(part==='part2'?ahuProcessState:productionProcessState)(record['현공정']),pnd=calendarDate(record.PND,meta?.date1904),actual=calendarDate(source?record[field]:'',meta?.date1904);
    if(state!=='ready')reasons.push('미완료 또는 공정 미분류 · 분모 제외');
    if(!source)reasons.push('검증된 실제 최종 완료일·PND 열 매핑 없음');
    if(!pnd.iso)reasons.push('PND '+pnd.reason);
    if(source&&!actual.iso)reasons.push('실제 최종 완료일 '+actual.reason);
    const item={record,pnd:pnd.iso,actual:source?actual.iso:'',days:pnd.iso&&actual.iso?actual.day-pnd.day:null,reasons};
    if(reasons.length)excluded.push(item);else (actual.day<=pnd.day?onTime:late).push(item);
  }
  const eligible=onTime.length+late.length,status=!records.length?'empty':!hasActual?'unavailable':eligible?'available':'empty';
  return {status,source,onTime,late,excluded,eligible,rate:eligible?onTime.length/eligible*100:null,hasActual};
}
export function createProductionAdherence(root,part){
  const area=root.querySelector('[data-production-adherence]');let model=null,selected=null,page=0,signature='';
  const columnLetter=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  function render(){
    if(!model)return;const m=model;
    if(m.status==='unavailable'){area.innerHTML='<p class="production-adherence-note" data-adherence-unavailable>PND 준수율: 실제 완료일 자료가 없어 산정할 수 없습니다</p>';return;}
    const provenance=m.source?`반영된 ${part==='part2'?'2':'1'}파트 원본 ${m.source.pndTitle}(${columnLetter(m.source.pndPosition)}열) · 실제 최종 완료일: ${m.source.title}(${columnLetter(m.source.position)}열)`:'실제 최종 완료일 열 매핑 없음';
    const header=m.status==='available'?`<button type="button" class="production-adherence-card" data-adherence-open aria-pressed="${Boolean(selected)}"><span>PND 준수율 <small>완료 건 기준</small></span><strong>${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(m.rate)}<small>%</small></strong><span>준수 ${m.onTime.length} / 판정 ${m.eligible}건 · 기한 후 완료 ${m.late.length}건</span><span class="production-adherence-action">근거 목록 보기</span></button>`:`<p class="production-adherence-note">PND 준수율: 산정 대상 없음${m.excluded.length?' · '+button('판정 제외 '+m.excluded.length+'건 확인','data-adherence-open'):''}</p>`;
    if(!selected){area.innerHTML=header+(m.source?`<p class="production-adherence-source">${esc(provenance)} · 건수 기준</p>`:'');return;}
    const rows=m[selected]||[],labels={onTime:'준수',late:'기한 후 완료',excluded:'판정 제외'};page=Math.max(0,Math.min(page,Math.ceil(rows.length/100)-1));
    const columns=['PND','실제 최종 완료일','Yard',{label:'Hull No.',key:'HullNo'},'규격','현공정',{label:'비교 결과',value:r=>r.__reason}];
    const values=rows.slice(page*100,(page+1)*100).map(item=>({...item.record,PND:item.pnd||String(item.record.PND??'')||'미입력','실제 최종 완료일':item.actual||String(item.record[m.source?.field]??'')||'미입력',__reason:item.reasons.join(' / ')||(item.days>0?item.days+'일 기한 후 완료':item.days===0?'PND 당일 완료':Math.abs(item.days)+'일 전 완료')}));
    area.innerHTML=header+`<section class="production-adherence-detail" tabindex="-1" aria-label="생산 PND 준수율 상세"><div class="production-list-heading"><h2>PND 준수율 · ${labels[selected]} ${rows.length}건</h2>${button('선택 해제','data-adherence-close')}</div><p>${esc(provenance)} · 수량 가중 없이 원본 행 건수로 집계합니다. ERP 대조 결과로 기준 PND를 변경하지 않습니다.</p><p>준수 ${m.onTime.length}건 / 판정 ${m.eligible}건 · 기한 후 완료 ${m.late.length}건 · 판정 제외 ${m.excluded.length}건. 미완료는 분모에 포함하지 않습니다.</p><div class="business-toolbar">${Object.entries(labels).map(([key,label])=>button(label+' '+m[key].length+'건',`data-adherence-bucket="${key}" aria-pressed="${selected===key}"`)).join('')}</div>${rows.length?table(columns,values):'<p class="hint">해당 조건의 자료가 없습니다.</p>'}<div class="business-toolbar">${page?button('이전 100건','data-adherence-page="-1"'):''}<span>${rows.length?page*100+1:0}~${Math.min((page+1)*100,rows.length)} / 전체 ${rows.length}건</span>${(page+1)*100<rows.length?button('다음 100건','data-adherence-page="1"'):''}</div></section>`;
  }
  area.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.hasAttribute('data-adherence-open')){selected=model.status==='available'?'onTime':'excluded';page=0;}if(b.dataset.adherenceBucket){selected=b.dataset.adherenceBucket;page=0;}if(b.hasAttribute('data-adherence-close'))selected=null;if(b.dataset.adherencePage)page+=Number(b.dataset.adherencePage);render();if(b.hasAttribute('data-adherence-open')){const detail=area.querySelector('.production-adherence-detail');detail?.scrollIntoView({block:'start',behavior:'smooth'});detail?.focus({preventScroll:true});}});
  return {update(records,meta,allRecords){const next=records.map(r=>r.id).join('|');if(next!==signature)page=0;signature=next;model=productionAdherence(records,{part,meta,allRecords});render();},getState:()=>({selected,page}),restore(state){selected=['onTime','late','excluded'].includes(state?.selected)?state.selected:null;page=Number.isSafeInteger(state?.page)?state.page:0;render();}};
}
