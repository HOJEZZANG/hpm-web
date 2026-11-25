import {canManageWeekly,weeklyPage,weeklyPageSize,deleteWeeklyRecords} from './weekly-actions.js?v=20261125-mobile';
import {$,api,esc,today,uid,user,isAdmin,field,table,button,shell,run,message,jsonOptions,protectForm} from './common.js?v=20261027-access';
import {weeklyDate,meetingDate,meetingRange,weekLabel,pndDate,combinedPlan} from '../weekly-data.mjs?v=20261031-meeting';

const fields=[['date','등록 회의일','date',{required:true,value:meetingDate(today())}],['part','파트','select',{values:['1 PART','2 PART','3 PART']}],['project','프로젝트명','text',{max:200}],['product','제품','text',{required:true,max:200}],['manager','담당자','text',{required:true,max:100}],['pnd','PND','date'],['problem','현황','textarea',{required:true,wide:true}],['planAction','계획·실행','textarea',{wide:true,max:5000}],['remark','비고','textarea',{wide:true}]];
const columns=[{label:'파트',key:'part'},{label:'프로젝트명',key:'project'},{label:'제품',key:'product'},{label:'현황',key:'problem'},{label:'담당자',key:'manager'},{label:'PND',key:'pnd',value:r=>pndDate(r.pnd)||r.pnd},{label:'비고',key:'remark'}];
const meetingInfo=r=>r.meetingDate?`회의일 ${r.meetingDate.replaceAll('-','.')}\n${weekLabel(r)}`:weekLabel(r);
const filterControl=c=>{
  const label=esc(c.label);
  if(['part','manager'].includes(c.key))return `<select data-weekly-filter="${c.key}" aria-label="${label} 필터"><option value="">전체</option></select>`;
  if(c.key==='pnd')return `<select data-weekly-filter="pndMode" aria-label="PND 조건"><option value="">전체</option><option value="range">날짜 범위</option><option value="empty">미입력</option><option value="text">날짜 미확인</option></select><div data-pnd-range hidden><label>시작<input type="date" data-weekly-filter="pndFrom" aria-label="PND 시작일"></label><label>종료<input type="date" data-weekly-filter="pndTo" aria-label="PND 종료일"></label></div>`;
  return `<input type="search" data-weekly-filter="${c.key}" aria-label="${label} 검색" placeholder="검색" autocomplete="off">`;
};
const tableHead=filters=>`<colgroup>${filters?'<col class="weekly-col-select">':''}${columns.map(c=>`<col class="weekly-col-${c.key}">`).join('')}</colgroup><thead><tr>${filters?'<th scope="col" class="weekly-select"><label><input type="checkbox" data-weekly-all aria-label="현재 페이지의 삭제 가능한 행 전체 선택"><span class="weekly-sr-only">현재 페이지 전체 선택</span></label></th>':''}${columns.map(c=>`<th scope="col"><span class="weekly-column-title">${esc(c.label)}</span>${filters?filterControl(c):''}</th>`).join('')}</tr></thead>`;
const reportRows=(rows,actions,selection)=>rows.length?rows.map(r=>`<tr data-weekly-id="${esc(r.id)}">${selection?'<td class="weekly-select">'+selection(r)+'</td>':''}${columns.map(c=>`<td data-column="${c.key}"${c.key==='pnd'&&pndDate(r.pnd)?' class="weekly-date"':''}>${['problem','remark'].includes(c.key)&&actions?'<span class="weekly-full-text">'+esc(c.value?c.value(r):r[c.key])+'</span><details class="weekly-mobile-text"><summary>'+esc(c.label)+' 전체 보기</summary><div>'+esc(c.value?c.value(r):r[c.key])+'</div></details>':esc(c.value?c.value(r):r[c.key])}${c.key==='project'&&actions?'<button type="button" class="btn outline weekly-mobile-detail" data-mobile-detail="'+esc(r.id)+'">상세</button>':''}${c.key==='remark'&&actions?actions(r):''}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${7+Boolean(selection)}">조건에 맞는 회의록이 없습니다.</td></tr>`;
const editable=r=>canManageWeekly(user(),r);
const rangeText=day=>weeklyDate(day)?`회의일 ${meetingDate(day).replaceAll('-','.')} · 보고기간 ${weekLabel(meetingRange(day))}`:'기준일 확인 필요';
const legacyWeek=r=>[r.key,r.monday,r.date,r.legacyDay,r.year&&r.week?`${r.year}년 ${r.week}주`:''].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' / ')||'기존 주간 정보 없음';
const pndOriginal=r=>[r.pnd&&r.pnd!==pndDate(r.pnd)?r.pnd:'',r.legacyPnd].filter((v,i,a)=>v&&a.indexOf(v)===i).join('\n');

export async function init(root){
  shell(root,'주간 팀 공정 회의록','수요일 팀 공정 회의 기준 · 보고기간: 목요일~수요일',`<div class="business-toolbar weekly-toolbar"><h2 class="weekly-meeting-title">주간 팀 공정 회의록</h2>${field('week','회의일','date',{value:meetingDate(today())})}${button('이전 회의','data-prev-meeting')}${button('다음 회의','data-next-meeting')}<output data-query-range class="weekly-range"></output>${button('새로 조회','data-refresh')}${button('인쇄','data-weekly-print')}${button('회의용 확대','data-meeting aria-pressed="false"')}</div><div data-list class="weekly-results"></div><details class="card weekly-legacy" data-legacy hidden><summary>기준일 확인이 필요한 기존 기록 (<span data-legacy-count>0</span>)</summary><p>원래 기준일을 복원할 수 없어 보고기간에 포함하지 않은 기록입니다. 기존 주간 정보를 보존했습니다.</p><div data-legacy-list></div></details><details class="card" open data-editor><summary data-editor-title>신규 등록</summary><form class="business-form weekly-form">${fields.map(f=>field(...f)).join('')}<div class="wide business-toolbar"><button class="btn primary" type="submit">신규 등록 저장</button>${button('신규','data-new')}</div></form></details><dialog class="weekly-detail" aria-labelledby="weeklyDetailTitle"><div data-detail-content></div><div class="business-toolbar">${button('닫기','data-close-detail')}</div></dialog><dialog class="weekly-delete-dialog" aria-labelledby="weeklyDeleteTitle"><h2 id="weeklyDeleteTitle">회의록 선택 삭제</h2><p data-delete-description></p><ul data-delete-targets></ul><p role="status" aria-live="polite" data-delete-progress></p><div class="business-toolbar">${button('취소','data-cancel-delete')}<button type="button" class="btn danger" data-confirm-delete>선택 삭제</button></div></dialog>`);
  const form=$('form',root),dirty=protectForm(form),query=$('[name=week]',root),dialog=$('dialog',root);
  form.elements.date.insertAdjacentHTML('afterend','<output data-register-range class="weekly-range"></output>');
  form.elements.pnd.insertAdjacentHTML('afterend','<small data-pnd-original class="weekly-original" hidden></small>');
  let selected=null,records=[],legacy=[],newId=uid(),sequence=0,loadedDay=null,normalScroll=0,page=0,mutating=false;const checked=new Set();let deleteTargets=[];const deleteDialog=$('.weekly-delete-dialog',root);
  const list=$('[data-list]',root),filters={part:'',project:'',product:'',problem:'',manager:'',pndMode:'',pndFrom:'',pndTo:'',remark:''};
  list.innerHTML=`<div class="weekly-result-tools"><output data-result-count role="status" aria-live="polite"></output><div class="weekly-selection-tools"><span data-weekly-selection role="status" aria-live="polite">선택 0건</span>${button('전체 선택 해제','data-weekly-clear')}<button type="button" class="btn danger" data-weekly-delete disabled>선택 0건 삭제</button>${button('필터 전체 초기화','data-weekly-reset')}</div></div><div class="business-table-wrap weekly-table-scroll" role="region" aria-label="주간 회의록 표" tabindex="0"><table class="business-table weekly-table">${tableHead(true)}<tbody></tbody></table></div><div class="weekly-pages" data-weekly-pages></div>`;
  const filteredRecords=()=>records.filter(r=>{
    if(['part','manager'].some(k=>filters[k]&&r[k]!==filters[k]))return false;
    if(['project','product','problem','remark'].some(k=>filters[k].trim()&&!String(r[k]??'').toLocaleLowerCase().includes(filters[k].trim().toLocaleLowerCase())))return false;
    const day=pndDate(r.pnd);
    if(filters.pndMode==='empty')return !String(r.pnd??'').trim();
    if(filters.pndMode==='text')return Boolean(String(r.pnd??'').trim())&&!day;
    if(filters.pndMode==='range')return Boolean(day)&&(!filters.pndFrom||day>=filters.pndFrom)&&(!filters.pndTo||day<=filters.pndTo);
    return true;
  });
  const selectable=r=>`<label><input type="checkbox" data-weekly-pick="${esc(r.id)}" aria-label="${esc(r.project||r.product||'프로젝트 미기재')} 삭제 대상 선택" ${checked.has(r.id)?'checked':''} ${editable(r)?'':'disabled'}><span class="weekly-sr-only">선택</span></label>`;
  function selectionState(){
    const current=weeklyPage(filteredRecords(),page).rows.filter(editable),n=current.filter(r=>checked.has(r.id)).length,all=$('[data-weekly-all]',list),stale=loadedDay!==query.value;
    all.checked=current.length>0&&n===current.length;all.indeterminate=n>0&&n<current.length;all.disabled=!current.length||mutating||stale;
    for(const input of list.querySelectorAll('[data-weekly-pick]')){input.checked=checked.has(input.dataset.weeklyPick);input.disabled=mutating||stale||!editable(find(input.dataset.weeklyPick));}
    $('[data-weekly-selection]',list).textContent='선택 '+checked.size+'건'+(checked.size?' · 현재 페이지 '+n+'건 · 다른 페이지·조건 밖 '+(checked.size-n)+'건':'');
    const button=$('[data-weekly-delete]',list);button.textContent='선택 '+checked.size+'건 삭제';button.disabled=!checked.size||mutating||stale;$('[data-weekly-clear]',list).disabled=!checked.size||mutating;
  }
  function renderResults(){
    const rows=filteredRecords(),current=weeklyPage(rows,page);page=current.page;
    $('tbody',list).innerHTML=reportRows(current.rows,owned,selectable);
    $('[data-result-count]',list).textContent=`검색 결과 ${rows.length}건 / 전체 ${records.length}건`;
    $('[data-weekly-pages]',list).innerHTML=`${page?button('이전 50건','data-weekly-page="-1"'):''}<span>${rows.length?page*weeklyPageSize+1:0}~${Math.min((page+1)*weeklyPageSize,rows.length)} / ${rows.length}건 · 현재 페이지 선택</span>${page<current.last?button('다음 50건','data-weekly-page="1"'):''}`;
    selectionState();
  }
  function renderCollection(){updateOptions();renderResults();$('[data-legacy]',root).hidden=!legacy.length;$('[data-legacy-count]',root).textContent=legacy.length;$('[data-legacy-list]',root).innerHTML=table([{label:'기존 주간 정보',value:legacyWeek},...columns],legacy,owned);}
  function clearSelection(){checked.clear();selectionState();}
  function busy(value){mutating=value;form.inert=value;for(const n of root.querySelectorAll('.weekly-toolbar input,.weekly-toolbar button,[data-weekly-filter],[data-new],[data-delete],[data-edit],[data-detail-edit]'))n.disabled=value;selectionState();}

  function updateOptions(){
    for(const key of ['part','manager']){
      const values=[...new Set([...records.map(r=>r[key]),filters[key]].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
      const control=$(`[data-weekly-filter="${key}"]`,list);
      control.innerHTML='<option value="">전체</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');control.value=filters[key];
    }
  }
  function changeFilter(e){
    const key=e.target.dataset.weeklyFilter;if(!Object.hasOwn(filters,key))return;
    filters[key]=e.target.value;page=0;$('[data-pnd-range]',list).hidden=filters.pndMode!=='range';renderResults();
  }
  list.addEventListener('input',changeFilter);list.addEventListener('change',changeFilter);
  const owner=user()?.id,meetingButton=$('[data-meeting]',root);
  function setMeeting(enabled){
    if(enabled)normalScroll=window.scrollY;
    root.classList.toggle('meeting-view',enabled);document.body.classList.toggle('hpm-weekly-meeting',enabled);
    meetingButton.textContent=enabled?'확대 닫기':'회의용 확대';meetingButton.setAttribute('aria-pressed',String(enabled));
    if(!enabled){window.scrollTo({top:normalScroll,behavior:'instant'});meetingButton.focus({preventScroll:true});}
  }
  function preparePrint(){
    if(!loadedDay||query.value!==loadedDay){message(root,'선택한 회의일의 조회를 완료한 후 인쇄하세요.',true);return false;}
    let sheet=document.getElementById('weeklyPrintSheet');if(!sheet){sheet=document.createElement('section');sheet.id='weeklyPrintSheet';document.body.append(sheet);}
    const rows=filteredRecords();
    sheet.innerHTML=`<div class="weekly-print-heading"><h1>주간 팀 공정 회의록</h1><p>${esc(rangeText(loadedDay))} · 검색 결과 ${rows.length}건 / 전체 ${records.length}건</p></div><div class="business-table-wrap"><table class="business-table weekly-table">${tableHead(false)}<tbody>${reportRows(rows)}</tbody></table></div>`;
    document.body.classList.add('hpm-weekly-print');return true;
  }
  window.addEventListener('beforeprint',()=>{if(root.isConnected&&root.classList.contains('active'))preparePrint();});
  window.addEventListener('afterprint',()=>document.body.classList.remove('hpm-weekly-print'));
  document.addEventListener('hpm:navigate',()=>{if(root.classList.contains('meeting-view')&&!root.classList.contains('active'))setMeeting(false);});
  document.addEventListener('hpm:auth',()=>{if(!root.isConnected||user()?.id!==owner){if(root.classList.contains('meeting-view'))setMeeting(false);document.getElementById('weeklyPrintSheet')?.remove();document.body.classList.remove('hpm-weekly-print');}});
  const owned=r=>`<div class="weekly-row-actions">${button('상세',`data-detail="${esc(r.id)}"`)}${editable(r)?`<details><summary aria-label="회의록 관리 메뉴">관리</summary><div>${button('수정',`data-edit="${esc(r.id)}"`)}${button('개별 삭제',`data-delete="${esc(r.id)}"`)}</div></details>`:''}</div>`;
  const find=id=>[...records,...legacy].find(r=>r.id===id);
  const hint=()=>{$('[data-register-range]',root).textContent=(selected&&form.elements.date.value===selected.referenceDate&&selected.referenceDate!==selected.meetingDate?'기존 기준일 유지 · ':'')+rangeText(form.elements.date.value);};
  root.querySelectorAll('input[type=date]').forEach(input=>{
    input.min='1900-01-01';input.max='9998-12-31';
    // Keep the native calendar icon and keyboard behavior when showPicker is absent
    // or unavailable (for example in a restricted embedded browser).
    input.addEventListener('click',()=>{if(typeof input.showPicker==='function'){try{input.showPicker();}catch{ /* Native icon and keyboard remain available. */ }}});
  });
  async function load(){
    if(!weeklyDate(query.value)){message(root,'회의일을 입력하세요.',true);return;}
    query.value=meetingDate(query.value);
    if(!selected&&form.dataset.dirty!=='true'){form.elements.date.value=query.value;hint();dirty.clean();}
    if(loadedDay!==query.value){page=0;checked.clear();selectionState();}const request=++sequence,day=query.value;let response;
    try{response=await api('weekly?week='+encodeURIComponent(day));}catch(error){if(request!==sequence||query.value!==day)return false;throw error;}
    if(request!==sequence||query.value!==day)return false;
    records=response.records;legacy=response.legacyRecords||[];loadedDay=day;
    $('[data-query-range]',root).textContent=rangeText(day);
    for(const id of checked)if(!records.some(r=>r.id===id&&editable(r)))checked.delete(id);renderCollection();
    return true;
  }
  function showOriginal(record){const original=pndOriginal(record),node=$('[data-pnd-original]',root);node.hidden=!original;node.textContent=original?'기존 PND 원문: '+original+'\n날짜를 변경하지 않으면 원문을 유지합니다.':'';}
  function fill(record){
    selected=record;form.reset();editorMode();
    for(const [key]of fields)form.elements[key].value=key==='date'?record.referenceDate||'':key==='pnd'?pndDate(record.pnd):key==='planAction'?combinedPlan(record):record[key]??'';
    form.elements.date.required=!record.unresolvedWeek;
    for(const key of ['product','manager','problem'])form.elements[key].required=Boolean(record[key]?.trim());
    showOriginal(record);hint();dirty.clean();
    $('[data-editor]',root).open=true;form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function editorMode(){root.dataset.editorMode=selected?'edit':'new';$('[data-editor-title]',root).textContent=selected?'회의록 수정 · '+(selected.project||selected.product||'안건'):'신규 등록';$('[type=submit]',form).textContent=selected?'수정 저장':'신규 등록 저장';}
  function reset(keep={date:form.elements.date.value,part:form.elements.part.value}){selected=null;newId=uid();form.reset();for(const [key,,,opts]of fields)form.elements[key].required=Boolean(opts?.required);form.elements.date.value=weeklyDate(keep.date)?keep.date:query.value||meetingDate(today());if(keep.part)form.elements.part.value=keep.part;showOriginal({});hint();dirty.clean();editorMode();$('[data-editor]',root).open=true;}
  function requestDelete(rows){
    if(mutating||loadedDay!==query.value){message(root,'선택한 회의일의 조회가 끝난 뒤 삭제하세요.',true);return;}deleteTargets=rows.filter(r=>r&&editable(r)).map(r=>({...r}));if(!deleteTargets.length)return;
    $('[data-delete-description]',root).textContent='아래 '+deleteTargets.length+'건을 삭제합니다. 삭제한 안건은 기존 삭제 방식에 따라 목록에서 제거됩니다.'+(deleteTargets.some(r=>r.id===selected?.id)?' 수정 중인 안건도 포함돼 있습니다.':'');
    $('[data-delete-targets]',root).innerHTML=deleteTargets.map(r=>'<li><strong>'+esc(r.project||'프로젝트 미기재')+'</strong> · '+esc([r.part,r.product,r.manager].filter(Boolean).join(' / '))+'</li>').join('');$('[data-delete-progress]',root).textContent='';$('[data-confirm-delete]',root).textContent='선택 '+deleteTargets.length+'건 삭제';deleteDialog.showModal();
  }
  async function confirmDelete(){if(mutating)return;const targets=deleteTargets.slice();if(!targets.length)return;busy(true);const controls=[...deleteDialog.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
    try{const results=await deleteWeeklyRecords(targets,{canDelete:r=>root.isConnected&&user()?.id===owner&&editable(r),remove:r=>api('weekly/'+r.id,jsonOptions('DELETE',{revision:r.revision})),onResult:(result,n)=>{if(result.status!=='failed'){records=records.filter(r=>r.id!==result.row.id);legacy=legacy.filter(r=>r.id!==result.row.id);checked.delete(result.row.id);if(selected?.id===result.row.id)reset();} $('[data-delete-progress]',root).textContent=n+' / '+targets.length+'건 확인';}});
      const deleted=results.filter(r=>r.status==='deleted'),absent=results.filter(r=>r.status==='absent'),failed=results.filter(r=>r.status==='failed');renderCollection();deleteDialog.close();message(root,'삭제 완료 '+deleted.length+'건'+(absent.length?' · 이미 없음 '+absent.length+'건':'')+' · 실패 '+failed.length+'건'+(failed.length?'\n'+failed.map(r=>(r.row.project||r.row.product||'안건')+': '+r.error).join('\n'):''),Boolean(failed.length));
    }finally{controls.forEach(b=>b.disabled=false);busy(false);}
  }

  function detail(record){
    const rows=[['회의일 · 보고기간',meetingInfo(record)],...(record.referenceDate&&record.referenceDate!==record.meetingDate?[['기존 기준일',record.referenceDate]]:[]),...(record.unresolvedWeek?[['기존 주간 정보',legacyWeek(record)]]:[]),...(record.legacyDate?[['기존 기준일 원문',record.legacyDate]]:[]),...(record.legacySqlDay?[['기존 주간 원문',record.legacySqlDay]]:[]),...columns.map(c=>[c.label,c.value?c.value(record):record[c.key]]),['계획·실행',combinedPlan(record)],...(pndOriginal(record)?[['기존 PND 원문',pndOriginal(record)]]:[])];
    $('[data-detail-content]',root).innerHTML='<h2 id="weeklyDetailTitle">주간 팀 공정 회의록 상세</h2><dl>'+rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd></div>`).join('')+'</dl>'+(editable(record)?button('수정',`data-detail-edit="${esc(record.id)}"`):'');
    if(!dialog.open)dialog.showModal();
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(mutating)return;
    if(b.hasAttribute('data-weekly-delete'))requestDelete([...checked].map(find));
    if(b.hasAttribute('data-confirm-delete'))void confirmDelete();
    if(b.hasAttribute('data-cancel-delete'))deleteDialog.close();
    if(b.hasAttribute('data-weekly-clear'))clearSelection();
    if(b.dataset.weeklyPage){page+=Number(b.dataset.weeklyPage);renderResults();}
    if(b.hasAttribute('data-refresh'))void run(root,b,load);
    if(b.hasAttribute('data-prev-meeting')||b.hasAttribute('data-next-meeting')){const day=meetingDate(query.value||today());query.value=new Date(Date.parse(day+'T00:00:00Z')+(b.hasAttribute('data-prev-meeting')?-7:7)*86400000).toISOString().slice(0,10);query.dispatchEvent(new Event('change'));}
    if(b.hasAttribute('data-meeting'))setMeeting(!root.classList.contains('meeting-view'));
    if(b.hasAttribute('data-weekly-print')&&preparePrint())window.print();
    if(b.hasAttribute('data-weekly-reset')){page=0;for(const key of Object.keys(filters))filters[key]='';list.querySelectorAll('[data-weekly-filter]').forEach(c=>c.value='');$('[data-pnd-range]',list).hidden=true;renderResults();}
    if(b.hasAttribute('data-new')&&dirty.replace()){reset();form.elements.project.focus();}
    if(b.hasAttribute('data-close-detail'))dialog.close();
    if(b.dataset.detail||b.dataset.mobileDetail){const r=find(b.dataset.detail||b.dataset.mobileDetail);if(r)detail(r);}
    const id=b.dataset.edit||b.dataset.detailEdit;
    if(id&&dirty.replace()){const r=find(id);if(r){dialog.close();if(root.classList.contains('meeting-view'))setMeeting(false);fill(r);}}
    if(b.dataset.delete)requestDelete([find(b.dataset.delete)]);
  });
  form.elements.date.addEventListener('input',hint);form.elements.date.addEventListener('change',()=>{if(weeklyDate(form.elements.date.value)&&(!selected||form.elements.date.value!==selected.referenceDate))form.elements.date.value=meetingDate(form.elements.date.value);hint();form.dispatchEvent(new Event('input',{bubbles:true}));});
  list.addEventListener('change',e=>{if(mutating)return;if(e.target.hasAttribute('data-weekly-all')){for(const r of weeklyPage(filteredRecords(),page).rows.filter(editable))e.target.checked?checked.add(r.id):checked.delete(r.id);selectionState();}if(e.target.dataset.weeklyPick){const r=find(e.target.dataset.weeklyPick);if(r&&editable(r)){e.target.checked?checked.add(r.id):checked.delete(r.id);selectionState();}}});
  deleteDialog.addEventListener('cancel',e=>{if(mutating)e.preventDefault();});
  query.addEventListener('change',()=>{if(mutating)return;checked.clear();page=0;selectionState();if(weeklyDate(query.value)){query.value=meetingDate(query.value);if(!selected&&form.dataset.dirty!=='true'){form.elements.date.value=query.value;hint();dirty.clean();}}void run(root,null,load);});
  root.addEventListener('hpm:restore-state',()=>void run(root,null,load));
  root.addEventListener('hpm:weekly-record',e=>void run(root,null,async()=>{if(e.detail.date)query.value=e.detail.date;if(await load()){const r=find(e.detail.id);if(r){if(r.unresolvedWeek)$('[data-legacy]',root).open=true;detail(r);}}}));
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(mutating)return;const draft=Object.fromEntries(new FormData(form)),editing=selected,keep={date:form.elements.date.value,part:form.elements.part.value};
    if(editing)for(const [key,value]of Object.entries(draft)){const before=key==='date'?editing.referenceDate||'':key==='pnd'?pndDate(editing.pnd):key==='planAction'?combinedPlan(editing):editing[key]??'';if(value===before)delete draft[key];}
    let saved=false;busy(true);
    try{await run(root,$('[type=submit]',form),async()=>{
      const result=await api('weekly/'+(editing?.id||newId),jsonOptions('PUT',{...draft,revision:editing?.revision||0}));if(!root.isConnected||user()?.id!==owner)return;
      const record=result.record;saved=true;checked.delete(record.id);records=records.filter(r=>r.id!==record.id);legacy=legacy.filter(r=>r.id!==record.id);
      if(record.unresolvedWeek)legacy.unshift(record);else if(record.meetingDate===loadedDay)records.unshift(record);page=0;reset(keep);renderCollection();message(root,'저장했습니다. 다음 안건을 입력하세요.');
      if(!record.unresolvedWeek&&record.meetingDate!==loadedDay){query.value=record.meetingDate;checked.clear();try{await load();}catch(error){message(root,'저장은 완료됐지만 목록 조회에 실패했습니다. 새로 조회해 주세요. '+error.message,true);}}
    });}finally{busy(false);if(saved&&root.isConnected){$('[data-editor]',root).open=true;form.elements.project.focus();}}
  });
  editorMode();hint();await run(root,null,load);
}
