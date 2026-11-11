import {$,api,esc,field,table,button,run,message,jsonOptions,shell,user,isAdmin,collection} from './common.js?v=20261027-access';
import {init as weekly} from './weekly.js?v=20261031-meeting';
import {init as production} from './production.js?v=20261104-status';
import {init as ahuPnd} from './ahu-pnd.js?v=20261111-yard';
import {createPresentation} from './presentation.js';
import {initNavigation} from './navigation.js?v=20261103-pressure';
import {initIssueView} from './issue-view.js?v=20261102-leave';
import {initIssueDraft} from './issue-draft.js?v=20261102-leave';
import {initIssueLoadState} from './issue-load-state.js?v=20261101-evidence';
import {initHistory} from './history.js?v=20261102-leave';
import {initEntry,noticePreview} from './home.js?v=20261109-notice-author';
import {initGlobalSearch,installSearchExecution,renderSearchResults,openNoticeDetail} from './home-search.js?v=20261106-notices';
import {initIssueDashboard} from './issue-dashboard.js?v=20261101-evidence';
import {accounts} from './accounts.js?v=20261027-access';
import {init as notices} from './notices.js?v=20261106-history';
import * as passwordPolicy from '../password-policy.mjs?v=20261027-pin';
window.HpmPasswordPolicy=passwordPolicy;
initEntry();initNavigation();initIssueView();initIssueDraft();initIssueLoadState();initHistory();initIssueDashboard();
window.createHpmPresentation=createPresentation;
const modules={weekly,production,ahuPnd,notices,search,accounts};
const initialized=new Set();
const pending=new Map();
let lastAccountId=null;
async function open(page){
  if(!modules[page])return;const root=document.getElementById(page+'Page');
  if(!user()){root.innerHTML='<div class="card business-login-note">로그인 후 이용할 수 있습니다. 우측 상단에서 서버 계정으로 로그인하세요.</div>';return;}
  if(pending.has(page))return pending.get(page);if(initialized.has(page))return;
  delete root.dataset.ready;
  const task=(async()=>{try{await modules[page](root);if(root.isConnected){initialized.add(page);root.dataset.ready='true';}}catch(e){if(root.isConnected){root.innerHTML=`<p role="alert">${esc(e.message)}</p>${button('다시 열기','data-retry')}`;$('[data-retry]',root).onclick=()=>open(page);}}finally{if(pending.get(page)===task)pending.delete(page);}})();pending.set(page,task);return task;
}
async function search(root){
  shell(root,'통합검색','공정 문제점·일정·주간 이슈·생산계획·공지사항을 검색합니다.',`<form class="card search-page-form" role="search">${field('q','검색어 (2자 이상)','search',{required:true,max:100})}<button type="submit" class="btn primary">검색</button></form><p class="search-page-status" data-search-status role="status" aria-live="polite"></p><div data-results></div>`);
  const form=$('form',root);form.elements.q.minLength=2;let sequence=0;
  form.onsubmit=async e=>{e.preventDefault();const q=form.elements.q.value.trim();if(q.length<2)return;const owner=JSON.stringify(user()),request=++sequence,status=$('[data-search-status]',root),list=$('[data-results]',root);status.setAttribute('role','status');status.textContent='검색 중…';list.replaceChildren();root.setAttribute('aria-busy','true');
    try{const result=await api('search?q='+encodeURIComponent(q));if(request!==sequence||owner!==JSON.stringify(user())||!root.isConnected||!root.classList.contains('active'))return;renderSearchResults(list,result.records);status.textContent='‘'+q+'’ 검색 결과 '+result.records.length+'건';}
    catch(error){if(request===sequence&&owner===JSON.stringify(user())&&root.isConnected){status.textContent=error.message;status.setAttribute('role','alert');}}
    finally{if(request===sequence)root.setAttribute('aria-busy','false');}
  };
  const onNavigate=()=>{if(!root.classList.contains('active')){sequence++;root.setAttribute('aria-busy','false');}};
  const onAuth=()=>{if(!root.isConnected||!user()){sequence++;form.reset();$('[data-results]',root).replaceChildren();$('[data-search-status]',root).textContent='';document.removeEventListener('hpm:navigate',onNavigate);document.removeEventListener('hpm:auth',onAuth);}};
  document.addEventListener('hpm:navigate',onNavigate);document.addEventListener('hpm:auth',onAuth);
}
document.addEventListener('hpm:navigate',e=>void open(e.detail));
document.addEventListener('hpm:auth',()=>{const accountId=user()?JSON.stringify([user().id,user().role,user().status,user().authRevision]):null;if(accountId&&accountId===lastAccountId)return;lastAccountId=accountId;initialized.clear();pending.clear();for(const page of Object.keys(modules)){const root=document.getElementById(page+'Page'),fresh=root.cloneNode(false);fresh.classList.remove('meeting-view');fresh.removeAttribute('data-ready');fresh.removeAttribute('data-dirty');fresh.removeAttribute('aria-busy');root.replaceWith(fresh);}const active=$('.portal-page.active');if(active)void open(active.id.replace(/Page$/,''));});
window.addEventListener('beforeunload',e=>{if(document.querySelector('.business-form[data-dirty=true],.portal-page[data-dirty=true]')){e.preventDefault();e.returnValue='';}});
window.HpmBusiness={open};
const homeGrid=document.querySelector('#homePage .home-grid');
homeGrid?.insertAdjacentHTML('beforeend',`<section class="card home-notices" aria-labelledby="homeNoticesTitle"><div class="card-head"><h2 id="homeNoticesTitle">공지사항</h2><a href="#/notices" id="homeNoticesLink">전체 공지 보기</a></div><div class="card-body" id="homeBusinessNotices" aria-live="polite"></div></section>`);
document.getElementById('homeNoticesLink').onclick=e=>{e.preventDefault();window.navigatePortal('notices');};
let noticesSequence=0;
async function refreshHomeNotices(){
  const sequence=++noticesSequence,owner=user()?.id;
  const el=document.getElementById('homeBusinessNotices');if(!el)return;
  if(!user()){el.textContent='로그인 후 공지사항을 조회할 수 있습니다.';return;}
  try{const r=await api('notices');if(sequence!==noticesSequence||user()?.id!==owner)return;el.innerHTML=r.records.slice(0,5).map(noticePreview).join('')||'<p class="hint">등록된 공지사항이 없습니다.</p>';}catch(e){if(sequence===noticesSequence&&user()?.id===owner)el.textContent=e.message;}
}
document.addEventListener('hpm:auth',()=>void refreshHomeNotices());
document.addEventListener('hpm:navigate',e=>{if(e.detail==='home')void refreshHomeNotices();});
installSearchExecution(open);initGlobalSearch();
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.meeting-view').forEach(r=>{r.classList.remove('meeting-view');const b=r.querySelector('[data-meeting]');if(b)b.textContent='회의용 확대';});});
