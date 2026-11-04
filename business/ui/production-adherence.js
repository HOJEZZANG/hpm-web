// Current saved process status, not a reconstruction of historical delivery dates.
import {productionProcessState,ahuProcessState} from './production-view.js?v=20261104-status';
import {koreanToday} from '../domain.mjs';
import {weeklyDate} from '../weekly-data.mjs';
import {esc,table,button} from './common.js';
export function productionAdherence(records,{part,today=koreanToday()}={}){
  const m={today,eligible:0,completed:[],active:[],unknown:[],future:[],excluded:[]};
  for(const record of records){
    const raw=String(record.PND??'').trim(),pnd=weeklyDate(raw),state=(part==='part2'?ahuProcessState:productionProcessState)(record['현공정']);
    const item={record,pnd,state,reason:!raw?'PND 누락':!pnd?'PND 날짜 오류':''};
    if(!pnd)m.excluded.push(item);else if(pnd>today)m.future.push({...item,reason:'미래 PND · 아직 도래하지 않음'});else{m.eligible++;m[state==='ready'?'completed':state==='active'?'active':'unknown'].push(item);}
  }
  m.due=[...m.completed,...m.active,...m.unknown];
  m.rate=m.eligible?m.completed.length/m.eligible*100:null;
  m.status=m.eligible?'available':'empty';
  m.missingPnd=m.excluded.filter(item=>item.reason==='PND 누락').length;m.invalidPnd=m.excluded.length-m.missingPnd;
  return m;
}
export function createProductionAdherence(root,part){
  const area=root.querySelector('[data-production-adherence]');let model=null,selected=null,page=0,signature='';
  const labels={due:'계산 대상 전체',completed:'완료',active:'진행 중',unknown:'완료 미확인',future:'미래 PND',excluded:'날짜 제외'};
  function render(){
    if(!model)return;const m=model;
    const value=m.rate===null?'산정 대상 없음':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(m.rate)+'<small>%</small>';
    const formula=m.eligible?`완료 ${m.completed.length}건 ÷ PND 도래 ${m.eligible}건 × 100`:'분모가 0건이므로 산정 대상 없음';
    const card=`<button type="button" class="production-adherence-card" data-adherence-open aria-expanded="${Boolean(selected)}"><span>PND 준수율 <small>현황 기준</small></span><strong data-adherence-rate>${value}</strong><span data-adherence-counts>PND 도래 ${m.eligible}건 중 완료 ${m.completed.length}건 · 완료 미확인 ${m.unknown.length}건</span><span>오늘까지 PND가 도래한 건의 현재 완료 비율입니다.</span><span class="production-adherence-action">계산 대상 목록 보기</span></button>`;
    const guide=`<details class="production-count-guide" data-adherence-guide><summary>계산 안내 · 미래 ${m.future.length}건 · 날짜 제외 ${m.excluded.length}건</summary><p>한국 날짜 ${esc(m.today)} 기준 · 현재 선택한 파트와 검색·필터·선택 조건의 저장된 생산자료를 사용합니다. ${formula}. 원본 행 1개 = 1건이며 수량을 가중하지 않습니다.</p><p>진행 중 ${m.active.length}건과 완료 미확인 ${m.unknown.length}건도 분모에 포함합니다. 미래 PND ${m.future.length}건은 완료 상태여도 제외합니다. PND 누락 ${m.missingPnd}건 · 날짜 오류 ${m.invalidPnd}건은 계산에서 제외합니다.</p><p>실제 완료일 기준의 과거 납기 준수 여부를 판정하는 지표가 아닙니다. 실제 완료일을 추정하거나 채우지 않습니다. ‘PND 경과’는 오늘 이전 계획의 목록이며 ${part==='part2'?'2파트는 완료 여부와 무관하게 집계합니다.':'1파트는 진행 중인 건만 집계합니다.'} PND 준수율은 오늘 도래분과 완료·진행 중·완료 미확인을 모두 포함하므로 기준이 다릅니다.</p></details>`;
    if(!selected){area.innerHTML=card+guide;return;}
    const rows=m[selected]||[];page=Math.max(0,Math.min(page,Math.ceil(rows.length/100)-1));
    const columns=[{label:'구분',key:'__state'},'PND','Yard',{label:'Hull No.',key:'HullNo'},'규격',{label:'원본 현재 공정',key:'현공정'},{label:'계산 근거',key:'__reason'}];
    const values=rows.slice(page*100,(page+1)*100).map(item=>({...item.record,PND:item.pnd||String(item.record.PND??'')||'미입력',__state:item.state==='ready'?'완료':item.state==='active'?'진행 중':'완료 미확인',__reason:item.reason||(item.state==='ready'?'PND 도래 · 분자·분모 포함':'PND 도래 · 분모 포함')}));
    area.innerHTML=card+guide+`<section class="production-adherence-detail" tabindex="-1" aria-label="생산 PND 준수율 상세"><div class="production-list-heading"><h2>PND 준수율 · ${labels[selected]} ${rows.length}건</h2>${button('목록 닫기','data-adherence-close')}</div><p>PND 도래 ${m.eligible}건 = 완료 ${m.completed.length}건 + 진행 중 ${m.active.length}건 + 완료 미확인 ${m.unknown.length}건. 원본 PND와 현재 공정을 확인하세요.</p><div class="business-toolbar" role="group" aria-label="PND 계산 대상 구분">${Object.entries(labels).map(([key,label])=>button(label+' '+m[key].length+'건',`data-adherence-bucket="${key}" aria-pressed="${selected===key}"`)).join('')}</div>${rows.length?table(columns,values):'<p class="hint">해당 조건의 자료가 없습니다.</p>'}<div class="business-toolbar">${page?button('이전 100건','data-adherence-page="-1"'):''}<span>${rows.length?page*100+1:0}~${Math.min((page+1)*100,rows.length)} / 전체 ${rows.length}건</span>${(page+1)*100<rows.length?button('다음 100건','data-adherence-page="1"'):''}</div></section>`;
  }
  area.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.hasAttribute('data-adherence-open')){selected='due';page=0;}if(b.dataset.adherenceBucket&&Object.hasOwn(labels,b.dataset.adherenceBucket)){selected=b.dataset.adherenceBucket;page=0;}if(b.hasAttribute('data-adherence-close'))selected=null;if(b.dataset.adherencePage)page+=Number(b.dataset.adherencePage);const guideOpen=area.querySelector('[data-adherence-guide]')?.open;render();area.querySelector('[data-adherence-guide]').open=Boolean(guideOpen);if(b.hasAttribute('data-adherence-open')){const detail=area.querySelector('.production-adherence-detail');detail?.scrollIntoView({block:'start',behavior:'smooth'});detail?.focus({preventScroll:true});}});
  return {update(records,{today}={}){const next=records.map(r=>r.id).join('|');if(next!==signature)page=0;signature=next;model=productionAdherence(records,{part,today});render();},getState:()=>({selected,page}),restore(state){selected=Object.hasOwn(labels,state?.selected)?state.selected:null;page=Number.isSafeInteger(state?.page)?state.page:0;render();}};
}
