import {$,api,esc,field,table,button,run,message,jsonOptions,shell,user,isAdmin,collection} from './common.js?v=20261023';
import {init as weekly} from './weekly.js?v=20261023';
import {init as production} from './production.js?v=20261023';
import {init as ahuPnd} from './ahu-pnd.js?v=20261027-real';
import {createPresentation} from './presentation.js';
import {initNavigation} from './navigation.js?v=20261026-ahu';
import {initIssueView} from './issue-view.js?v=20261021-brand';
import {initIssueLoadState} from './issue-load-state.js?v=20261023';
import {initHistory} from './history.js?v=20261026-ahu';
initNavigation();initIssueView();initIssueLoadState();initHistory();
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
async function accounts(root){
  shell(root,'사용자 승인','가입 계정은 관리자 승인 후 사용할 수 있습니다. 기존 PC의 브라우저 계정은 이전하지 않습니다.','<div data-users></div>');
  if(!isAdmin()){message(root,'관리자 권한이 필요합니다.',true);return;}
  const statuses={active:'승인됨',pending:'승인 대기',disabled:'거절 / 이용 중지'};
  const load=async()=>{const r=await window.apiRequest('/api/auth/users');$('[data-users]',root).innerHTML=table([{label:'ID',key:'id'},{label:'이름',key:'name'},{label:'권한',key:'role'},{label:'상태',value:r=>statuses[r.status]||r.status}],r.users,r=>r.role==='admin'?'관리자':button('승인',`data-user="${esc(r.id)}" data-status="active"`)+button(r.status==='pending'?'거절':'이용 중지',`data-user="${esc(r.id)}" data-status="disabled"`));};
  root.onclick=e=>{const b=e.target.closest('[data-user]');if(b)void run(root,b,async()=>{await window.apiRequest('/api/auth/users/'+b.dataset.user,jsonOptions('PUT',{status:b.dataset.status}));message(root,'서버에서 권한 변경을 확인했습니다.');await load();});};await run(root,null,load);
}
document.addEventListener('hpm:navigate',e=>void open(e.detail));
document.addEventListener('hpm:auth',()=>{const accountId=user()?.id||null;if(accountId&&accountId===lastAccountId)return;lastAccountId=accountId;initialized.clear();pending.clear();for(const page of Object.keys(modules)){const root=document.getElementById(page+'Page'),fresh=root.cloneNode(false);fresh.classList.remove('meeting-view');fresh.removeAttribute('data-ready');fresh.removeAttribute('data-dirty');fresh.removeAttribute('aria-busy');root.replaceWith(fresh);}const active=$('.portal-page.active');if(active)void open(active.id.replace(/Page$/,''));});
window.addEventListener('beforeunload',e=>{if(document.querySelector('.business-form[data-dirty=true],.portal-page[data-dirty=true],#issueForm[data-dirty=true]')){e.preventDefault();e.returnValue='';}});
window.HpmBusiness={open};
const homeGrid=document.querySelector('#homePage .home-grid');
homeGrid?.insertAdjacentHTML('beforeend',`<div class="card"><div class="card-head"><h2>공지사항 · 통합검색</h2></div><div class="card-body"><form id="homeBusinessSearch" class="business-toolbar"><label>통합검색 <input name="q" type="search" minlength="2" maxlength="100" required placeholder="업무 제목 · 대표 항목"></label><button type="submit" class="btn outline">검색</button></form><div id="homeBusinessNotices">로그인 후 공지사항을 조회할 수 있습니다.</div></div></div>`);
async function refreshHomeNotices(){
  const el=document.getElementById('homeBusinessNotices');if(!el)return;
  if(!user()){el.textContent='로그인 후 공지사항을 조회할 수 있습니다.';return;}
  try{const r=await api('notices');el.innerHTML=r.records.slice(0,5).map(n=>`<p><strong>${esc(n.title)}</strong><br>${esc(n.content)}</p>`).join('')||'등록된 공지사항이 없습니다.';}catch(e){el.textContent=e.message;}
}
document.addEventListener('hpm:auth',()=>void refreshHomeNotices());
document.addEventListener('hpm:navigate',e=>{if(e.detail==='home')void refreshHomeNotices();});
document.getElementById('homeBusinessSearch')?.addEventListener('submit',async e=>{e.preventDefault();const q=new FormData(e.target).get('q');window.navigatePortal('search');await open('search');const form=document.querySelector('#searchPage form');if(form){form.elements.q.value=q;form.requestSubmit();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.meeting-view').forEach(r=>{r.classList.remove('meeting-view');const b=r.querySelector('[data-meeting]');if(b)b.textContent='회의용 확대';});});
