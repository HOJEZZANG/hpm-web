import {$,api,esc,field,table,button,run,message,jsonOptions,shell,user,isAdmin,collection} from './common.js?v=20261027-access';
import {init as weekly} from './weekly.js?v=20261027-access';
import {init as production} from './production.js?v=20261028-dashboard';
import {init as ahuPnd} from './ahu-pnd.js?v=20261027-model2';
import {createPresentation} from './presentation.js';
import {initNavigation} from './navigation.js?v=20261027-supplies';
import {initIssueView} from './issue-view.js?v=20261029-home';
import {initIssueLoadState} from './issue-load-state.js?v=20261023';
import {initHistory} from './history.js?v=20261029-home';
import {initEntry,noticePreview} from './home.js?v=20261029-home';
import {accounts} from './accounts.js?v=20261027-access';
import * as passwordPolicy from '../password-policy.mjs?v=20261027-pin';
window.HpmPasswordPolicy=passwordPolicy;
initEntry();initNavigation();initIssueView();initIssueLoadState();initHistory();
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
async function notices(root){return collection(root,{type:'notices',title:'공지사항',description:'관리자가 게시한 생산관리 공지사항',admin:true,fields:[['title','제목','text',{required:true,max:200}],['content','공지내용','textarea',{required:true,max:5000,wide:true}]],columns:[{label:'제목',key:'title'},{label:'내용',key:'content'},{label:'수정일',key:'updatedAt'}]});}
async function search(root){
  shell(root,'통합검색','공정 문제점·일정·주간 이슈·생산계획·공지사항을 검색합니다.',`<form class="business-form">${field('q','검색어 (2자 이상)','search',{required:true,max:100})}<button type="submit" class="btn primary">검색</button></form><div data-results></div>`);
  const labels={weekly:'주간 이슈',notices:'공지사항',issue:'공정 문제점',as:'AS 출장',team:'팀 일정',production:'생산 일정'};
  const form=$('form',root);form.onsubmit=e=>{e.preventDefault();const q=form.elements.q.value;void run(root,$('[type=submit]',form),async()=>{const r=await api('search?q='+encodeURIComponent(q));$('[data-results]',root).innerHTML=table([{label:'업무',value:r=>labels[r.type]||r.type},{label:'제목/대표 항목',key:'label'}],r.records,(r,i)=>button('업무 열기',`data-index="${i}"`));$('[data-results]',root).onclick=e=>{const index=e.target.closest('[data-index]')?.dataset.index;if(index===undefined)return;const row=r.records[Number(index)];window.navigatePortal(row.type);};});};
}
document.addEventListener('hpm:navigate',e=>void open(e.detail));
document.addEventListener('hpm:auth',()=>{const accountId=user()?JSON.stringify([user().id,user().role,user().status,user().authRevision]):null;if(accountId&&accountId===lastAccountId)return;lastAccountId=accountId;initialized.clear();pending.clear();for(const page of Object.keys(modules)){const root=document.getElementById(page+'Page'),fresh=root.cloneNode(false);fresh.classList.remove('meeting-view');fresh.removeAttribute('data-ready');fresh.removeAttribute('data-dirty');fresh.removeAttribute('aria-busy');root.replaceWith(fresh);}const active=$('.portal-page.active');if(active)void open(active.id.replace(/Page$/,''));});
window.addEventListener('beforeunload',e=>{if(document.querySelector('.business-form[data-dirty=true],.portal-page[data-dirty=true],#issueForm[data-dirty=true]')){e.preventDefault();e.returnValue='';}});
window.HpmBusiness={open};
const homeGrid=document.querySelector('#homePage .home-grid');
homeGrid?.insertAdjacentHTML('beforeend',`<section class="card home-notices" aria-labelledby="homeNoticesTitle"><div class="card-head"><h2 id="homeNoticesTitle">공지사항</h2><a href="#/notices" id="homeNoticesLink">전체 공지 보기</a></div><div class="card-body" id="homeBusinessNotices" aria-live="polite"></div></section><section class="card home-search" aria-labelledby="homeSearchTitle"><div class="card-head"><h2 id="homeSearchTitle">통합검색</h2></div><div class="card-body"><form id="homeBusinessSearch" class="business-toolbar"><label>업무 검색 <input name="q" type="search" minlength="2" maxlength="100" required placeholder="문제점 · 일정 · 생산계획 · 공지사항"></label><button type="submit" class="btn primary">검색</button></form></div></section>`);
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
document.getElementById('homeBusinessSearch')?.addEventListener('submit',async e=>{e.preventDefault();const q=new FormData(e.target).get('q');window.navigatePortal('search');await open('search');const form=document.querySelector('#searchPage form');if(form){form.elements.q.value=q;form.requestSubmit();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.meeting-view').forEach(r=>{r.classList.remove('meeting-view');const b=r.querySelector('[data-meeting]');if(b)b.textContent='회의용 확대';});});
