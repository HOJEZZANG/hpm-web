import {productionProcessState,ahuProcessState,isProductionRisk} from './production-view.js?v=20261123-priority';
import {koreanToday,addDays} from '../domain.mjs';
import {weeklyDate} from '../weekly-data.mjs';
import {esc,table,button,api} from './common.js';
export const priorityLabels={overdue:'PND 경과 · 미완료',upcoming:'7일 내 PND 도래 · 미완료',unknown:'공정 확인 필요',dates:'PND 확인 필요'};
export function productionPriority(records,{part,today=koreanToday()}={}){
 const model={today,last:addDays(today,6),overdue:[],upcoming:[],unknown:[],dates:[]};
 for(const record of records){
  const process=String(record['현공정']??'').trim(),state=(part==='part2'?ahuProcessState:productionProcessState)(process),raw=String(record.PND??'').trim(),pnd=weeklyDate(raw);
  const reasons=[...(state==='unknown'?[process?'공정 분류 확인 필요':'공정 미기재']:[]),...(!pnd?[raw?'PND 날짜 오류':'PND 미기재']:[])];
  const item={record,state,pnd,reasons,days:pnd?Math.round((Date.parse(pnd+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null};
  if(state==='unknown')model.unknown.push(item);
  if(!pnd)model.dates.push(item);
  else{if(isProductionRisk(state,pnd,today,'overdue'))model.overdue.push(item);if(isProductionRisk(state,pnd,today,'upcoming'))model.upcoming.push(item);}
 }
 for(const key of ['overdue','upcoming'])model[key].sort((a,b)=>a.pnd.localeCompare(b.pnd)||String(a.record.id).localeCompare(String(b.record.id)));
 return model;
}
export function createProductionPriority(root,part){
 const area=root.querySelector('[data-production-priority]');let model=null,selected='overdue',page=0,available=false,sequence=0;
 const dialog=root.ownerDocument.createElement('dialog');dialog.className='production-related-dialog';dialog.setAttribute('aria-label','관련 공정 기록 확인');root.append(dialog);
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-close-related]'))dialog.close();});
 function render(){
  if(!available||!model){area.innerHTML='<div class="card"><h2>우선 점검 대상</h2><p role="status">생산자료 조회 전입니다. 조회에 성공한 후 건수를 표시합니다.</p></div>';return;}
  const rows=model[selected],slice=rows.slice(page*50,(page+1)*50),quantity=items=>items.reduce((sum,item)=>sum+(Number.isFinite(Number(item.record['수량']))?Number(item.record['수량']):0),0);
  area.innerHTML=`<h2>우선 점검 대상</h2><p>현재 파트·검색·필터·선택 조건 · 한국 날짜 ${esc(model.today)} · 원본 생산자료 한 행 = 1건. 수량은 별도 합계입니다.</p><div class="production-priority-cards">${['overdue','upcoming','unknown'].map(key=>`<button type="button" class="production-priority-card priority-${key}" data-priority="${key}" aria-pressed="${selected===key}"><span>${priorityLabels[key]}</span><strong data-priority-count="${key}">${model[key].length}<small>건</small></strong><span>수량 ${quantity(model[key]).toLocaleString('ko-KR')}</span></button>`).join('')}</div><p class="production-priority-guide">경과: 오늘 이전 · 도래: 오늘~${esc(model.last)}(오늘 포함 7일) · 확인되지 않은 공정은 미완료·지연으로 확정하지 않습니다.</p><p>${button(`PND 확인 필요 ${model.dates.length}건`,`data-priority="dates" aria-pressed="${selected==='dates'}"`)} 날짜 누락·오류는 날짜 기반 점검에서 제외합니다. 공정 확인 필요와 중복될 수 있습니다.</p><section tabindex="-1" data-priority-list aria-label="우선 점검 목록"><h3>${priorityLabels[selected]} <span data-priority-list-count>${rows.length}건</span></h3>${table([{label:'야드',value:i=>i.record.Yard},{label:'호선',value:i=>i.record.HullNo},{label:'프로젝트 / 제품',value:i=>[i.record['프로젝트번호']||i.record['프로젝트명'],i.record['규격']||i.record['제품 규격']||i.record['품번']||i.record['LINE 5000']||i.record['분류']].filter(Boolean).join(' / ')},{label:'현재 공정',value:i=>i.record['현공정']||'미기재'},{label:'PND',value:i=>i.pnd||i.record.PND||'미기재'},{label:'경과·잔여',value:i=>i.days===null?'날짜 확인 필요':i.days<0?`${-i.days}일 경과`:i.days===0?'오늘 도래':`${i.days}일 남음`},{label:'확인 사유',value:i=>i.reasons.join(' / ')||'명확한 미완료 공정 · 반영 PND 기준'}],slice,(i,n)=>String(i.record.HullNo??'').trim()?button('관련 문제점·회의록',`data-production-related="${page*50+n}"`):'<span>호선 정보 부족 · 연결 생략</span>')}<div class="business-toolbar">${page?button('이전 50건','data-priority-page="-1"'):''}<span>${rows.length?page*50+1:0}~${Math.min((page+1)*50,rows.length)} / ${rows.length}건</span>${(page+1)*50<rows.length?button('다음 50건','data-priority-page="1"'):''}</div><p class="hint">관련 기록은 확인 근거이며 납기 지연 원인으로 확정하지 않습니다.</p></section>`;
 }
 area.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.priority&&Object.hasOwn(priorityLabels,b.dataset.priority)){selected=b.dataset.priority;page=0;render();const list=area.querySelector('[data-priority-list]');list.focus({preventScroll:true});list.scrollIntoView({block:'start',behavior:'smooth'});}
  if(b.dataset.priorityPage){page+=Number(b.dataset.priorityPage);render();}
  if(b.hasAttribute('data-production-related')){
   const item=model[selected][Number(b.dataset.productionRelated)],request=++sequence,owner=window.hpmServerUser?.id;b.disabled=true;
   try{const data=await api('production-related?part='+part+'&row='+encodeURIComponent(item.record.id));if(!root.isConnected||window.hpmServerUser?.id!==owner||request!==sequence)return;
    dialog.innerHTML='<h2>관련 공정 문제점·주간 팀 공정 회의록</h2><p>'+esc(data.message)+'</p><p>연결된 기록이 있어도 납기 지연 원인으로 확정하지 않습니다.</p>'+data.groups.map(g=>`<section><h3>${esc(g.label)} · ${g.records.length}건</h3><p>${esc(g.basis)}</p>${g.records.map(r=>`<details><summary>${esc(r.title||'기존 기록')} · ${esc(r.date||'일자 미기록')}</summary><dl>${Object.entries(r.fields).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||'미기록')}</dd></div>`).join('')}</dl></details>`).join('')}</section>`).join('')+button('닫기','data-close-related');dialog.showModal();
   }catch(error){if(root.isConnected&&window.hpmServerUser?.id===owner){dialog.innerHTML='<h2>관련 기록 조회 실패</h2><p>'+esc(error.message)+'</p>'+button('닫기','data-close-related');dialog.showModal();}}finally{b.disabled=false;}
  }
 });
 render();return {update(records,options){model=productionPriority(records,{part,...options});available=true;page=0;render();},getState:()=>({selected,page}),restore(value){if(Object.hasOwn(priorityLabels,value?.selected))selected=value.selected;page=0;render();}};
}
