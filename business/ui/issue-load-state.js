// A failed or unverified read must never masquerade as a confirmed empty database.
export function initIssueLoadState(){
  for(const id of ['homePage','issuePage']){
    const root=document.getElementById(id),notice=document.createElement('div');notice.className='data-load-notice';notice.dataset.issueStatus='';notice.setAttribute('role','status');
    root.querySelector('.module-banner,.home-hero')?.after(notice);
    notice.onclick=async e=>{const button=e.target.closest('[data-retry-issues]');if(!button)return;button.disabled=true;try{await window.loadIssues();window.applyFilters();window.renderDashboard();window.renderStatistics();window.renderPortalHome();}catch{}finally{window.renderIssueLoadState();}};
  }
  const scope=document.createElement('div');scope.id='issueFilterScope';scope.className='issue-filter-scope';scope.setAttribute('aria-live','polite');document.getElementById('issueList').before(scope);
  window.renderIssueLoadState=()=>{
    const state=window.issueDataStatus();
    const text=!state.authenticated?'로그인 후 서버의 문제점 기록을 조회합니다.':state.pending?'문제점 서버 조회 중…':state.error?state.error+(state.count?' 이전에 조회한 '+state.count+'건을 표시합니다. 현재 서버 상태는 미확인입니다.':' 목록과 집계는 미확인 상태입니다.'):state.loaded?'서버 조회 확인 · 전체 문제점 '+state.count+'건':'문제점 서버 조회를 기다리고 있습니다.';
    for(const notice of document.querySelectorAll('[data-issue-status]')){notice.hidden=state.loaded&&!state.error&&!state.pending;notice.classList.toggle('error',Boolean(state.error));notice.replaceChildren(Object.assign(document.createElement('span'),{textContent:text}));if(state.authenticated&&state.error&&!state.pending){const button=document.createElement('button');button.type='button';button.className='btn outline';button.dataset.retryIssues='';button.textContent='다시 조회';notice.append(button);}}
    if(!state.loaded&&!state.count){
      for(const id of ['homeOpenIssues','homeOverdueIssues','sumTotal','sumOpen','sumOverdue','sumLead','statTotal','statCloseRate','statLead','statFollowup']){const el=document.getElementById(id);if(el)el.textContent='—';}
      for(const id of ['homeRecentIssues','homePndAlerts','deliveryAlertList','recentList','dashboardStatusChart','dashboardProductChart','dashboardProcessChart','dashboardDeptChart','statProductChart','statProcessChart','statTypeChart','statDeptChart','statStatusChart']){const el=document.getElementById(id);if(el)el.replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:state.error?'서버 조회 실패 · 위 안내에서 다시 조회해 주세요.':state.authenticated?'서버 조회 대기 중':'로그인 후 조회할 수 있습니다.'}));}
      const alert=document.getElementById('homePndAlertCount');if(alert)alert.textContent='미확인';
    }
  };
  window.renderIssueLoadState();
}
