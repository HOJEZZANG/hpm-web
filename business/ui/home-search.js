import {$,api,esc,table,button,user} from './common.js?v=20261027-access';
const labels={weekly:'주간 이슈',notices:'공지사항',issue:'공정 문제점',as:'AS 출장',team:'팀 일정',production:'생산 일정'};
const identity=()=>user()?JSON.stringify([user().id,user().role,user().status,user().authRevision]):null;
export function renderSearchResults(root,records){
  records=records.map(r=>r.type==='production'?{...r,label:String(r.label||'').replace(/^2파트\(AHU\)/,'2파트')}:r);
  root.innerHTML=table([{label:'업무',value:r=>labels[r.type]||r.type},{label:'제목/대표 항목',key:'label'}],records,(r,i)=>button('상세 열기',`data-index="${i}"`));
  root.onclick=async e=>{
    const index=e.target.closest('[data-index]')?.dataset.index,record=index===undefined?null:records[Number(index)],owner=identity();if(!record||!owner)return;
    try{if(await window.navigatePortal(record.type)===false||identity()!==owner)return;
    if(record.type==='issue'){if(!window.getIssueForView(record.id))await window.loadIssues();if(identity()===owner){window.switchManageView('list');window.openIssueDetails(record.id);}}
    if(record.type==='weekly'){await window.HpmBusiness.open('weekly');if(identity()===owner)document.getElementById('weeklyPage').dispatchEvent(new CustomEvent('hpm:weekly-record',{detail:record}));}
    if(record.type==='production'){await window.HpmBusiness.open('production');if(identity()===owner)await document.getElementById('productionPage').hpmOpenProductionRecord?.(record);}
    if(record.type==='as'||record.type==='team'){await window.refreshCalendar(record.type);if(identity()===owner)window.editCalendarEvent(record.type,record.id);}
    if(record.type==='notices'){await window.HpmBusiness.open('notices');if(identity()===owner)await document.getElementById('noticesPage').hpmOpenRecord?.(record);}
    }catch(error){if(identity()===owner)window.showToast(error.message);}
  };
}
export function initGlobalSearch(){
  const form=$('#sidebarSearch'),input=form.elements.q;
  form.onsubmit=async e=>{e.preventDefault();const q=input.value.trim();if(q.length<2)return;await window.HpmSearch.execute(q);window.closePortalMenu?.();};
  const mobile=document.createElement('button');mobile.id='mobileSearch';mobile.type='button';mobile.className='mobile-search';mobile.setAttribute('aria-label','통합검색 열기');mobile.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
  document.getElementById('themeToggle').before(mobile);
  mobile.onclick=async()=>{if(await window.navigatePortal('search')===false)return;await window.HpmBusiness.open('search');document.querySelector('#searchPage [name=q]')?.focus();};
  document.addEventListener('hpm:auth',()=>{if(!user())form.reset();});
}
export function installSearchExecution(open){
  window.HpmSearch={async execute(q){const owner=identity();if(!owner)return;if(await window.navigatePortal('search')===false)return;await open('search');if(identity()!==owner)return;const form=$('#searchPage form');form.elements.q.value=q;form.requestSubmit();}};
}
export async function openNoticeDetail(root,record){
  const owner=identity(),{records}=await api('notices');if(identity()!==owner||!root.isConnected)return;const notice=records.find(r=>r.id===record.id);if(!notice)return;
  root.querySelector('dialog')?.remove();const dialog=document.createElement('dialog');dialog.className='search-detail';dialog.setAttribute('aria-label','공지사항 상세');dialog.innerHTML=`<h2>${esc(notice.title)}</h2><p>${esc(notice.content)}</p><button type="button" class="btn outline">닫기</button>`;root.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();
}
