// URLs and history.state contain route identifiers only. UI values stay in this document's memory.
const pages=new Set(['home','issue','weekly','production','ahuPnd','as','team','fireStatus','fireAc','notices','search','accounts','mypage']);
const tabs=new Set(['manage','dashboard','statistics']);
function route(page='home',tab='manage'){return {page:pages.has(page)?page:'home',tab:page==='issue'&&tabs.has(tab)?tab:'manage'};}
const key=r=>r.page+(r.page==='issue'?'/'+r.tab:'');
const read=()=>{const [page,tab]=location.hash.replace(/^#\/?/,'').split('/');return route(page,tab);};
const url=r=>location.pathname+location.search+'#/'+key(r);
const controls='#keywordFilter,#productFilter,#processFilter,#deptFilter,#statusFilter,#occurStartFilter,#occurEndFilter,#statStart,#statEnd,#statProduct,#statProcess,#statDept,#asFilterStartDate,#asFilterEndDate,#teamFilterStartDate,#teamFilterEndDate,#teamFilterType,#asFilterTypes input,#productionPage [data-filters] input,#productionPage [data-filters] select,#weeklyPage [name=week],#searchPage [name=q]';
export function initHistory(){
  const states=new Map();let current=null,started=false,sequence=0,restoring=false,owner=null,travel=null,popBusy=false;
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
      window.restorePortalCalendarMonths?.(saved.months);if(entry.route.page==='issue'){window.switchManageView(saved.manageView||'create',{restore:true});window.applyFilters();window.renderStatistics();}if(['as','team'].includes(entry.route.page))window.applyCalendarFilter(entry.route.page);
      if(root?.hpmRestoreState)await root.hpmRestoreState(saved.pageState);else root?.dispatchEvent(new Event('hpm:restore-state'));if(entry.route.page==='search'&&root?.querySelector('[name=q]')?.value.length>=2)root.querySelector('form')?.requestSubmit();
      await new Promise(resolve=>requestAnimationFrame(resolve));if(current?.id!==entry.id)return;[...(root?.querySelectorAll('.business-table-wrap,.calendar-scroll')||[])].forEach((el,i)=>el.scrollLeft=saved.tableScroll[i]||0);scrollTo({top:saved.scroll,behavior:'instant'});
    }else scrollTo({top:0,behavior:'instant'});
  }
  async function navigate(page,tab,options={}){
    if(page==='calendar')page=window.getPortalCalendarTab?.()||'as';if(!pages.has(page)){return window.navigatePortal(page,tab,{render:true});}
    const r=route(page,tab);if(!started)return render(r);
    const move=async()=>{
      capture();if(!render(r))return false;
      if(current&&key(current.route)===key(r)){if(options.replace)history.replaceState({hpm:1,id:current.id,index:current.index},'',url(r));return true;}
      const entry={id:'hpm-'+(++sequence),index:options.replace?(current?.index||0):(current?.index||0)+1,route:r};current=entry;
      history[options.replace?'replaceState':'pushState']({hpm:1,id:entry.id,index:entry.index},'',url(r));await restore(entry);return true;
    };
    return !options.skipIssueGuard&&current&&key(current.route)!==key(r)?window.HpmIssueDraft.run(move):move();
  }
  window.HpmHistory={rendering:false,navigate,async resume(){if(!window.hpmServerUser||!current)return;if(current.route.page==='accounts'&&window.hpmServerUser.role!=='admin')return navigate('home',null,{replace:true});render(current.route);await restore(current);},async start(){
    const requested=read();started=true;const r=requested.page==='accounts'&&window.hpmServerUser&&window.hpmServerUser.role!=='admin'?route('home'):requested;current={id:'hpm-'+(++sequence),index:0,route:r};history.replaceState({hpm:1,id:current.id,index:0},'',url(r));if(window.hpmServerUser){render(r);await restore(current);}
  }};
  function travelTo(entry){
    const delta=entry.index-(history.state?.index??entry.index);
    if(!delta)return Promise.resolve();
    return new Promise(resolve=>{travel={entry,resolve};history.go(delta);});
  }
  window.addEventListener('popstate',async event=>{
    if(!started)return;
    if(travel){
      const index=event.state?.index;
      if(index===travel.entry.index&&event.state?.id===travel.entry.id){const done=travel.resolve;travel=null;done();}
      else if(Number.isInteger(index))history.go(travel.entry.index-index);
      return;
    }
    // Repeated Back/Forward while a decision is pending must not replace its destination.
    if(popBusy){await travelTo(current);return;}
    capture();const origin=current,target={id:event.state?.hpm?event.state.id:'hpm-'+(++sequence),index:event.state?.hpm?event.state.index:(current?.index||0)+1,route:read()};
    if(!event.state?.hpm)history.replaceState({hpm:1,id:target.id,index:target.index},'',url(target.route));
    popBusy=true;
    try{
      if(window.HpmIssueDraft.isDirty()||window.HpmIssueDraft.isPending()||window.issueDraftBusy()){
        // Return the URL to its origin before asking; leave the current DOM untouched.
        await travelTo(origin);
        await window.HpmIssueDraft.run(async()=>{
          await travelTo(target);
          if(!render(target.route)){await travelTo(origin);return false;}
          restoring=true;current=target;try{await restore(target);}finally{restoring=false;}return true;
        });
      }else{
        if(!render(target.route)){await travelTo(origin);return;}
        restoring=true;current=target;try{await restore(target);}finally{restoring=false;}
      }
    }finally{popBusy=false;}
  });
  // Capture before navigation; scrolling only updates the current entry's offset.
  window.addEventListener('scroll',()=>{if(started&&!restoring&&current){const saved=states.get(current.id);if(saved)saved.scroll=scrollY;}},{passive:true});
  document.addEventListener('hpm:auth',()=>{const id=window.hpmServerUser?.id||null;if(!id||owner&&id!==owner){states.clear();if(started){current={id:'hpm-'+(++sequence),index:current?.index||0,route:route('home')};history.replaceState({hpm:1,id:current.id,index:current.index},'',url(current.route));render(current.route);}}owner=id;});
}
