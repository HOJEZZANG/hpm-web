import {esc} from './common.js';

const seoul=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function koreanTime(now=new Date()){
  const p=Object.fromEntries(seoul.formatToParts(now).map(p=>[p.type,p.value]));
  const day=`${p.year}-${p.month}-${p.day}`,weekday=['일','월','화','수','목','금','토'][new Date(day+'T00:00:00Z').getUTCDay()];
  return {day,date:`${p.year}.${p.month}.${p.day} (${weekday})`,time:`${p.hour}:${p.minute}:${p.second}`};
}
export function monthPeriod(day){const [y,m]=day.split('-').map(Number);return {start:day.slice(0,7)+'-01',end:day.slice(0,7)+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()};}
export const issueLocation=i=>`${String(i.yard||'').trim()||'미입력'} / ${String(i.hullNo||'').trim()||'미입력'}`;
export function createClock(render,{now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
  let timer=null;
  function tick(){if(timer!==null)cancel(timer);render(koreanTime(new Date(now())));timer=schedule(tick,1000-now()%1000);}
  return {start:tick,stop(){if(timer!==null)cancel(timer);timer=null;}};
}
export function initEntry(){
  window.HpmHome={koreanTime,monthPeriod,issueLocation};
  const clock=createClock(({date,time})=>{document.getElementById('portalClockDate').textContent=date;document.getElementById('portalClockTime').textContent=time;});
  window.HpmClock=clock;
  window.addEventListener('focus',clock.start);window.addEventListener('pageshow',clock.start);
  document.addEventListener('visibilitychange',()=>document.hidden?clock.stop():clock.start());
  const workspace=document.getElementById('portalWorkspace'),entry=document.getElementById('authEntry'),slot=document.getElementById('authEntryForm'),loading=document.getElementById('authEntryLoading'),modal=document.getElementById('authModal');
  let dismiss;
  window.HpmEntry={
    set(state){
      const logged=state==='authenticated';document.documentElement.dataset.auth=state;
      workspace.hidden=!logged;workspace.inert=!logged;entry.hidden=logged;loading.hidden=state!=='checking';slot.hidden=state==='checking';
      if(logged){document.body.append(modal);modal.querySelector('.auth-dialog').setAttribute('aria-modal','true');modal.querySelector('.auth-dialog').setAttribute('role','dialog');}
      else{slot.append(modal);modal.querySelector('.auth-dialog').removeAttribute('aria-modal');modal.querySelector('.auth-dialog').setAttribute('role','region');document.body.classList.remove('sidebar-open');window.closePortalMenu?.();document.body.style.overflow='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('.auth-modal.show:not(#authModal)').forEach(n=>n.classList.remove('show'));}
      if(!logged){clearTimeout(dismiss);const n=document.getElementById('loginSuccess');n.classList.remove('show');n.textContent='';}
    },
    success(){const n=document.getElementById('loginSuccess');clearTimeout(dismiss);n.textContent='승인된 계정으로 로그인했습니다.';n.classList.add('show');dismiss=setTimeout(()=>{n.classList.remove('show');},3000);}
  };
  window.HpmEntry.set('checking');
}

export function noticePreview(n){
  const text=String(n.content||''),long=text.length>240||text.split('\n').length>4;
  return `<article class="home-notice"><h3>${esc(n.title)}</h3><time>${esc(n.updatedAt?new Date(n.updatedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'')}</time>${long?`<p class="notice-preview">${esc(text.slice(0,240))}${text.length>240?'…':''}</p><details><summary>공지 전체 보기</summary><div class="notice-content">${esc(text)}</div></details>`:`<p class="notice-content">${esc(text)}</p>`}</article>`;
}
