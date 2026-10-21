const paths={home:'m3 10 9-7 9 7v10h-6v-6H9v6H3z',chart:'M4 20V11m8 9V4m8 16v-7',issue:'M7 3h10v4h4v14H3V7h4z M8 11h8m-8 4h8',week:'M4 5h16v16H4z M7 2v6m10-6v6M4 11h16',plan:'M4 4h16v16H4zM8 8h8m-8 4h8m-8 4h5',calendar:'M4 5h16v16H4zM8 2v6m8-6v6M4 11h16',box:'m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4m-9 4v11',truck:'M2 6h12v12H2zM14 10h5l3 4v4h-8M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4m13 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4',meal:'M5 2v7m4-7v7M3 5h8m-4 4v13M19 2v20m0-20c-5 4-5 10 0 10',fire:'M13 2c2 5-3 6-1 10 2-1 3-3 4-5 5 6 5 14-4 15C2 21 2 13 7 8c0 4 3 5 4 5-3-5 3-7 2-11z',notice:'M4 5h16v14H4zM8 9h8m-8 4h5',search:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16m6-2 6 6',users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 9v-2c0-6 14-6 14 0v2m1-17c5 0 5 8 0 8m2 3c4 0 4 4 4 6'};
const icon=name=>`<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.plan}"/></svg>`;
const item=(label,page,glyph,tab='')=>`<button type="button" class="menu-item" data-page="${page}" ${tab?`data-issue-tab="${tab}"`:''}>${icon(glyph)}<span class="menu-label">${label}</span></button>`;
const group=(id,label,body)=>`<div class="menu-group"><button type="button" class="menu-parent" aria-expanded="true" aria-controls="${id}"><span class="menu-label">${label}</span><span class="menu-chevron" aria-hidden="true">⌄</span></button><div class="submenu" id="${id}">${body}</div></div>`;
import {externalServices} from './external-services.js';
const external=(key,glyph)=>{const {label,url}=externalServices[key];return `<a class="menu-item external-menu" data-service="${key}" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${label}, 외부 서비스 새 탭">${icon(glyph)}<span class="menu-label">${label}<small>외부 서비스 ↗</small></span></a>`;};
export function initNavigation(){
  const nav=document.getElementById('portalNavigation');
  nav.innerHTML=item('홈','home','home')+group('productionMenu','생산관리',item('현황 대시보드','issue','chart','dashboard')+item('공정 문제점 관리','issue','issue','manage')+item('주간 이슈관리','weekly','week')+item('생산 일정관리','production','plan')+item('통계·개선자료','issue','chart','statistics'))+group('calendarMenu','출장·일정 관리',item('출장·일정 캘린더','calendar','calendar'))+group('supportMenu','지원업무',external('supplies','box')+external('vehicles','truck'))+group('fireStatusSubmenu','공장동 소화기 점검 현황',item('AHU 공장','fireStatus','fire'))+group('commonMenu','공통',item('공지사항','notices','notice')+item('통합검색','search','search')+item('사용자 승인','accounts','users'));
  nav.querySelector('[data-page=accounts]').hidden=true;
  const toggle=document.getElementById('menuToggle'),backdrop=document.getElementById('menuBackdrop');
  const close=()=>{document.body.classList.remove('sidebar-open');toggle.setAttribute('aria-expanded','false');backdrop.hidden=true;};
  toggle.onclick=()=>{const open=!document.body.classList.contains('sidebar-open');document.body.classList.toggle('sidebar-open',open);toggle.setAttribute('aria-expanded',String(open));backdrop.hidden=!open;};
  backdrop.onclick=close;
  nav.onclick=e=>{const parent=e.target.closest('.menu-parent');if(parent){window.togglePortalMenu(parent);return;}const b=e.target.closest('[data-page]');if(b){window.navigatePortal(b.dataset.page,b.dataset.issueTab);close();}else if(e.target.closest('a'))close();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('sidebar-open')){close();toggle.focus();}});
  document.addEventListener('hpm:auth',()=>{nav.querySelector('[data-page=accounts]').hidden=window.hpmServerUser?.role!=='admin';});
  window.closePortalMenu=close;
}
