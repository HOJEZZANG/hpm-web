import {esc} from './common.js';
export function koreanHistoryTime(value){
  if(!value)return '—';
  // Legacy values without a timezone have no verified instant; preserve their original display.
  if(!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return value;
  const date=new Date(value);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)+' (한국 시간)';
}
const fields=items=>`<dl class="issue-detail-fields">${items.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`).join('')}</dl>`;
const history=items=>items?.length?`<ol class="detail-timeline">${[...items].toReversed().map(h=>`<li><div class="timeline-meta"><time>${esc(koreanHistoryTime(h.at))}</time><strong>${esc(h.actor||'—')}</strong><span class="badge gray">${esc(h.status||'—')}</span></div><p>${esc(h.note||'변경 내용 없음')}</p></li>`).join('')}</ol>`:'<p class="hint">저장된 이력이 없습니다.</p>';
export const hasIssueValue=value=>value!==null&&value!==undefined&&value!==false&&String(value).trim()!=='';
export function initIssueView(){
  window.formatIssueHistoryTime=koreanHistoryTime;
  window.switchManageView=view=>{
    const listing=view==='list';document.getElementById('issueEditorPane').hidden=listing;document.getElementById('issueRecordsPane').hidden=!listing;
    for(const b of document.querySelectorAll('[data-issue-view]')){const selected=b.dataset.issueView===(listing?'list':'create');b.setAttribute('aria-selected',String(selected));b.classList.toggle('active',selected);}
    if(listing)window.applyFilters();
  };
  document.querySelector('[data-issue-view=create]').onclick=()=>window.switchManageView('create');
  document.querySelector('[data-issue-view=list]').onclick=()=>window.switchManageView('list');
  document.querySelector('[data-issue-tabs]').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-issue-view]')],index=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?1:(index+1)%2;buttons[next].focus();buttons[next].click();};
  const dialog=document.getElementById('issueDetailDialog');let previouslyFocused;
  document.getElementById('closeIssueDetail').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{if(!document.getElementById('photoLightbox').open)document.body.style.overflow='';if(previouslyFocused?.isConnected)previouslyFocused.focus();});
  window.openIssueDetails=id=>{
    const i=window.getIssueForView(id);if(!i||!window.hpmServerUser)return;
    if(!dialog.open)previouslyFocused=document.activeElement;
    document.getElementById('issueDetailTitle').textContent=i.title||i.description?.split('\n')[0]||'문제점 상세';
    document.getElementById('issueDetailSummary').innerHTML=`<span class="detail-location">${esc(window.HpmHome.issueLocation(i))}</span><span class="badge ${esc(window.getStatusClass?.(i.status)||'gray')}">${esc(i.status||'—')}</span><span>발생일 ${esc(i.occurDate||'—')}</span><span>작성자 ${esc(i.reporter||'—')}</span>`;
    const additional=[['공정',i.process],['문제 유형',i.issueType],['담당자',i.feedbackOwner],['납품일',i.deliveryDate],['조치 예정일',i.dueDate],['실제 완료일',i.completedDate],['파트',i.part],['공장',i.factory],['기존 Yard/Hull 정보',i.projectNo],['기존 등록일',i.registerDate],['우선순위',i.priority],['발견자',i.finder],['효과 확인자',i.verifier],['후속 반영',i.followupFlag?'관리 대상':'']].filter(([,v])=>hasIssueValue(v));
    const narratives=[['원인 분석',i.causeFeedback],['재발방지',i.prevention]].filter(([,v])=>hasIssueValue(v));
    document.getElementById('issueDetailBody').innerHTML=`
      <section class="detail-section"><h3>기본정보</h3>${fields([['제품명',i.product],['제품 규격',i.productNo],['Yard',i.yard||'미입력'],['Hull No.',i.hullNo||'미입력'],['귀책부서',i.responsibleDept],['공정 PND',i.processPnd],['비고',i.remark],['등록시각',koreanHistoryTime(i.createdAt)],['수정시각',koreanHistoryTime(i.updatedAt)]])}</section>
      <section class="detail-section detail-content"><h3>핵심 내용</h3><div class="detail-narratives"><section><h4>문제점 상세내용</h4><p>${esc(i.description||'—')}</p></section><section><h4>조치내용</h4><p>${esc(i.actionDetail||'—')}</p></section></div></section>
      <section class="detail-section"><h3>현장 · 조치 후 사진 비교</h3><div class="issue-detail-photos">${[['현장 사진',i.images],['조치 후 사진',i.afterImages]].map(([label,photos])=>`<section><h4>${label} <span class="hint">${photos?.length||0}장</span></h4><div class="detail-photo-grid">${(photos||[]).map((src,index)=>`<button type="button" class="detail-photo" data-photo="${esc(window.issuePhotoUrl(src))}" aria-label="${label} ${index+1} 확대"><img src="${esc(window.issuePhotoUrl(src))}" alt="${label} ${index+1}" loading="lazy"></button>`).join('')||'<p class="hint">첨부 사진 없음</p>'}</div></section>`).join('')}</div><p class="hint">사진을 선택하면 확대합니다. 사진 추가는 수정하기에서 할 수 있습니다.</p></section>
      ${additional.length||narratives.length?`<details class="detail-additional" data-legacy-issue><summary>기존 정보</summary><div>${additional.length?fields(additional):''}${narratives.map(([label,value])=>`<section class="detail-text"><h4>${esc(label)}</h4><p>${esc(value)}</p></section>`).join('')}</div></details>`:''}
      <details class="detail-additional" data-issue-history><summary>처리 이력 (${i.history?.length||0})</summary><div>${history(i.history)}</div></details>`;
    document.getElementById('issueDetailBody').onclick=e=>{const photo=e.target.closest('[data-photo]');if(photo){photo.focus();window.openPhotoLightbox(photo.dataset.photo);}};
    document.getElementById('editIssueDetail').onclick=()=>{if(window.editIssue(id)===false)return;dialog.close();document.getElementById('description').focus();};
    if(!dialog.open)dialog.showModal();dialog.scrollTop=0;document.body.style.overflow='hidden';document.getElementById('closeIssueDetail').focus();
  };
  window.switchManageView('create');
}
