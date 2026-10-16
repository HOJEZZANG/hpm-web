import {esc} from './common.js';
export function initIssueView(){
  window.switchManageView=view=>{
    const listing=view==='list';document.getElementById('issueEditorPane').hidden=listing;document.getElementById('issueRecordsPane').hidden=!listing;
    for(const b of document.querySelectorAll('[data-issue-view]')){const selected=b.dataset.issueView===(listing?'list':'create');b.setAttribute('aria-selected',String(selected));b.classList.toggle('active',selected);}
    if(listing)window.applyFilters();
  };
  document.querySelector('[data-issue-view=create]').onclick=()=>window.switchManageView('create');
  document.querySelector('[data-issue-view=list]').onclick=()=>window.switchManageView('list');
  document.querySelector('[data-issue-tabs]').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-issue-view]')],index=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?1:(index+1)%2;buttons[next].focus();buttons[next].click();};
  const dialog=document.getElementById('issueDetailDialog');document.getElementById('closeIssueDetail').onclick=()=>dialog.close();
  window.openIssueDetails=id=>{
    const i=window.getIssueForView(id);if(!i||!window.hpmServerUser)return;
    const fields=[['관리번호',i.issueNo],['발생일',i.occurDate],['작성자',i.reporter],['제품명',i.product],['YARD',i.yard],['HULL NO.',i.hullNo],['제품 NO.',i.productNo],['귀책부서',i.responsibleDept],['상태',i.status],['비고',i.remark],['문제점 상세내용',i.description],['조치내용',i.actionDetail],['공정',i.process],['기존 프로젝트 정보',i.projectNo],['문제 유형',i.issueType],['공정 PND',i.processPnd],['납품일',i.deliveryDate],['담당자',i.feedbackOwner],['조치 예정일',i.dueDate],['실제 완료일',i.completedDate],['원인/Feedback',i.causeFeedback],['재발방지',i.prevention],['파트',i.part],['공장',i.factory]];
    document.getElementById('issueDetailBody').innerHTML=`<dl class="issue-detail-fields">${fields.map(([label,value])=>`<div${['문제점 상세내용','조치내용','원인/Feedback','재발방지'].includes(label)?' class="wide"':''}><dt>${esc(label)}</dt><dd>${esc(value||'미지정')}</dd></div>`).join('')}</dl><div class="issue-detail-photos">${[['현장 사진',i.images],['조치 후 사진',i.afterImages]].map(([label,photos])=>`<section><h3>${label}</h3>${(photos||[]).map(src=>`<button type="button" class="detail-photo" data-photo="${esc(window.issuePhotoUrl(src))}" aria-label="${label} 확대"><img src="${esc(window.issuePhotoUrl(src))}" alt="${label}"></button>`).join('')||'<p class="hint">첨부된 사진이 없습니다.</p>'}</section>`).join('')}</div><h3>처리 이력</h3>${(i.history||[]).toReversed().map(h=>`<p class="detail-history">${esc(h.at)} · ${esc(h.actor)} · ${esc(h.status)}<br>${esc(h.note)}</p>`).join('')||'<p class="hint">저장된 이력이 없습니다.</p>'}`;
    document.getElementById('issueDetailBody').onclick=e=>{const photo=e.target.closest('[data-photo]');if(photo){dialog.close();window.openPhotoLightbox(photo.dataset.photo);}};
    document.getElementById('editIssueDetail').onclick=()=>{dialog.close();window.editIssue(id);document.getElementById('description').focus();};dialog.showModal();
  };
  window.switchManageView('create');
}
