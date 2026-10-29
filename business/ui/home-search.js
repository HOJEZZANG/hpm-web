import {$,api,esc,table,button,user} from './common.js?v=20261027-access';

const labels={weekly:'주간 이슈',notices:'공지사항',issue:'공정 문제점',as:'AS 출장',team:'팀 일정',production:'생산 일정'};

// The home disclosure and the full search page share labels and route handling.
export function renderSearchResults(root,records,compact=false){
  root.innerHTML=compact
    ? records.length?`<ul class="home-search-list">${records.map((r,i)=>`<li><button type="button" data-index="${i}"><span class="badge blue">${esc(labels[r.type]||r.type)}</span><span>${esc(r.label||'제목 미입력')}</span><span aria-hidden="true">↗</span></button></li>`).join('')}</ul>`:'<p class="home-search-empty">검색 결과가 없습니다. 다른 검색어로 다시 검색해 주세요.</p>'
    : table([{label:'업무',value:r=>labels[r.type]||r.type},{label:'제목/대표 항목',key:'label'}],records,(r,i)=>button('업무 열기',`data-index="${i}"`));
  root.onclick=e=>{
    const index=e.target.closest('[data-index]')?.dataset.index;
    const record=index===undefined?null:records[Number(index)];
    if(record)window.navigatePortal(record.type);
  };
}

export function initHomeSearch(){
  const home=$('#homePage'),form=$('#homeBusinessSearch'),input=form.elements.q;
  const submit=$('[type=submit]',form),results=$('#homeSearchResults');
  const status=$('[data-home-search-status]',results),list=$('[data-home-search-list]',results);
  const identity=()=>user()?JSON.stringify([user().id,user().role,user().status,user().authRevision]):null;
  let sequence=0;
  function close(focus=false){
    sequence++;results.hidden=true;results.setAttribute('aria-busy','false');
    submit.setAttribute('aria-expanded','false');list.replaceChildren();list.onclick=null;status.textContent='';
    if(focus)input.focus();
  }
  input.addEventListener('input',()=>input.setCustomValidity(''));
  form.addEventListener('submit',async e=>{
    e.preventDefault();const owner=identity(),q=input.value.trim();
    if(!owner)return;
    if(q.length<2){input.setCustomValidity('검색어는 2자 이상 입력하세요.');input.reportValidity();return;}
    const request=++sequence;
    results.hidden=false;results.setAttribute('aria-busy','true');submit.setAttribute('aria-expanded','true');
    list.replaceChildren();list.onclick=null;status.setAttribute('role','status');status.classList.remove('error');status.textContent='검색 중…';
    try{
      const response=await api('search?q='+encodeURIComponent(q));
      if(request!==sequence||identity()!==owner)return;
      renderSearchResults(list,response.records,true);
      status.textContent=`‘${q}’ 검색 결과 ${response.records.length}건`;
    }catch(error){
      if(request!==sequence||identity()!==owner)return;
      status.setAttribute('role','alert');status.classList.add('error');status.textContent=error.message;
    }finally{if(request===sequence)results.setAttribute('aria-busy','false');}
  });
  $('[data-home-search-close]',results).onclick=()=>close(true);
  home.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!results.hidden){e.preventDefault();close(true);}
  });
  document.addEventListener('hpm:auth',()=>{close();form.reset();input.setCustomValidity('');});
  document.addEventListener('hpm:navigate',()=>close());
}
