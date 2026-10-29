// URLs and history.state contain route identifiers only. UI values stay in this document's memory.
const pages=new Set(['home','issue','weekly','production','ahuPnd','as','team','fireStatus','notices','search','accounts','mypage']);
const tabs=new Set(['manage','dashboard','statistics']);
function route(page='home',tab='manage'){return {page:pages.has(page)?page:'home',tab:page==='issue'&&tabs.has(tab)?tab:'manage'};}
const key=r=>r.page+(r.page==='issue'?'/'+r.tab:'');
const read=()=>{const [page,tab]=location.hash.replace(/^#\/?/,'').split('/');return route(page,tab);};
const url=r=>location.pathname+location.search+'#/'+key(r);
const controls='#keywordFilter,#productFilter,#processFilter,#deptFilter,#statusFilter,#occurStartFilter,#occurEndFilter,#statStart,#statEnd,#statProduct,#statProcess,#statDept,#asFilterStartDate,#asFilterEndDate,#teamFilterStartDate,#teamFilterEndDate,#teamFilterType,#asFilterTypes input,#productionPage [data-filters] input,#productionPage [data-filters] select,#weeklyPage [name=week],#searchPage [name=q]';
export function initHistory(){
  const states=new Map();let current=null,started=false,sequence=0,restoring=false,skipPop=false,owner=null;
  history.scrollRestoration='manual';
  function capture(){
    if(!current)return;const root=document.getElementById(current.route.page+'Page'),values=[];
    [...(root?.querySelectorAll(controls)||[])].forEach((el,index)=>values.push({index,value:el.value,checked:el.type==='checkbox'?el.checked:undefined}));
    states.set(current.id,{values,scroll:scrollY,months:window.getPortalCalendarMonths?.(),pageState:root?.hpmGetState?.(),manageView:document.querySelector('[data-issue-view][aria-selected=true]')?.dataset.issueView,tableScroll:[...(root?.querySelectorAll('.business-table-wrap,.calendar-scroll')||[])].map(el=>el.scrollLeft)});
  }
  function render(r){
    window.HpmHistory.rendering=true;try{return window.navigatePortal(r.page,r.tab,{render:true})!==false;}finally{window.HpmHistory.rendering=false;}
  }
  async function restore(entry){
    const saved=states.get(entry.id);await window.HpmBusiness?.open(entry.route.page);if(current?.id!==entry.id)return;
    if(saved){const root=document.getElementById(entry.route.page+'Page');await root?.hpmLoadState?.(saved.pageState);if(current?.id!==entry.id)return;const inputs=[...(root?.querySelectorAll(controls)||[])];for(const v of saved.values){const el=inputs[v.index];if(el){el.value=v.value;if(v.checked!==undefined)el.checked=v.checked;}}
      window.restorePortalCalendarMonths?.(saved.months);if(entry.route.page==='issue'){window.switchManageView(saved.manageView||'create');window.applyFilters();window.renderStatistics();}if(['as','team'].includes(entry.route.page))window.applyCalendarFilter(entry.route.page);
      if(root?.hpmRestoreState)await root.hpmRestoreState(saved.pageState);else root?.dispatchEvent(new Event('hpm:restore-state'));if(entry.route.page==='search'&&root?.querySelector('[name=q]')?.value.length>=2)root.querySelector('form')?.requestSubmit();
      await new Promise(resolve=>requestAnimationFrame(resolve));if(current?.id!==entry.id)return;[...(root?.querySelectorAll('.business-table-wrap,.calendar-scroll')||[])].forEach((el,i)=>el.scrollLeft=saved.tableScroll[i]||0);scrollTo({top:saved.scroll,behavior:'instant'});
    }else scrollTo({top:0,behavior:'instant'});
  }
  async function navigate(page,tab,options={}){
    if(page==='calendar')page=window.getPortalCalendarTab?.()||'as';if(!pages.has(page)){return window.navigatePortal(page,tab,{render:true});}
    const r=route(page,tab);if(!started)return render(r);
    capture();if(!render(r))return false;
    if(current&&key(current.route)===key(r)){if(options.replace)history.replaceState({hpm:1,id:current.id,index:current.index},'',url(r));return true;}
    const entry={id:'hpm-'+(++sequence),index:options.replace?(current?.index||0):(current?.index||0)+1,route:r};current=entry;
    history[options.replace?'replaceState':'pushState']({hpm:1,id:entry.id,index:entry.index},'',url(r));await restore(entry);return true;
  }
  window.HpmHistory={rendering:false,navigate,async resume(){if(!window.hpmServerUser||!current)return;if(current.route.page==='accounts'&&window.hpmServerUser.role!=='admin')return navigate('home',null,{replace:true});render(current.route);await restore(current);},async start(){
    const requested=read();started=true;const r=requested.page==='accounts'&&window.hpmServerUser&&window.hpmServerUser.role!=='admin'?route('home'):requested;current={id:'hpm-'+(++sequence),index:0,route:r};history.replaceState({hpm:1,id:current.id,index:0},'',url(r));if(window.hpmServerUser){render(r);await restore(current);}
  }};
  window.addEventListener('popstate',async event=>{
    if(!started||skipPop){skipPop=false;return;}capture();const target=read(),index=event.state?.hpm?event.state.index:(current?.index||0)+1;
    if(!render(target)){if(event.state?.hpm&&index!==current.index){skipPop=true;history.go(current.index-index);}else history.replaceState({hpm:1,id:current.id,index:current.index},'',url(current.route));return;}
    restoring=true;current={id:event.state?.hpm?event.state.id:'hpm-'+(++sequence),index,route:target};if(!event.state?.hpm)history.replaceState({hpm:1,id:current.id,index},'',url(target));try{await restore(current);}finally{restoring=false;}
  });
  // Capture before navigation; scrolling only updates the current entry's offset.
  window.addEventListener('scroll',()=>{if(started&&!restoring&&current){const saved=states.get(current.id);if(saved)saved.scroll=scrollY;}},{passive:true});
  document.addEventListener('hpm:auth',()=>{const id=window.hpmServerUser?.id||null;if(!id||owner&&id!==owner){states.clear();if(started){current={id:'hpm-'+(++sequence),index:current?.index||0,route:route('home')};history.replaceState({hpm:1,id:current.id,index:current.index},'',url(current.route));render(current.route);}}owner=id;});
}
