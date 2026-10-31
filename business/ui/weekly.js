import {$,api,esc,today,uid,user,isAdmin,field,table,button,shell,run,message,jsonOptions,protectForm} from './common.js?v=20261027-access';
import {weeklyDate,meetingDate,meetingRange,weekLabel,pndDate,combinedPlan} from '../weekly-data.mjs?v=20261031-meeting';

const fields=[['date','등록 회의일','date',{required:true,value:meetingDate(today())}],['part','파트','select',{values:['1 PART','2 PART','3 PART']}],['project','프로젝트명','text',{max:200}],['product','제품','text',{required:true,max:200}],['manager','담당자','text',{required:true,max:100}],['pnd','PND','date'],['problem','현황','textarea',{required:true,wide:true}],['planAction','계획·실행','textarea',{wide:true,max:5000}],['remark','비고','textarea',{wide:true}]];
const columns=[{label:'회의일 · 보고기간',value:r=>r.meetingDate?`회의일 ${r.meetingDate.replaceAll('-','.')}\n${weekLabel(r)}`:weekLabel(r)},{label:'파트',key:'part'},{label:'프로젝트명',key:'project'},{label:'제품',key:'product'},{label:'현황',key:'problem'},{label:'담당자',key:'manager'},{label:'PND',value:r=>pndDate(r.pnd)||r.pnd},{label:'계획·실행',value:combinedPlan},{label:'비고',key:'remark'}];
const editable=r=>isAdmin()||r.owner===user()?.id;
const rangeText=day=>weeklyDate(day)?`회의일 ${meetingDate(day).replaceAll('-','.')} · 보고기간 ${weekLabel(meetingRange(day))}`:'기준일 확인 필요';
const legacyWeek=r=>[r.key,r.monday,r.date,r.legacyDay,r.year&&r.week?`${r.year}년 ${r.week}주`:''].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' / ')||'기존 주간 정보 없음';
const pndOriginal=r=>[r.pnd&&r.pnd!==pndDate(r.pnd)?r.pnd:'',r.legacyPnd].filter((v,i,a)=>v&&a.indexOf(v)===i).join('\n');

export async function init(root){
  shell(root,'주간 이슈관리','수요일 부서회의 기준 · 보고기간: 목요일~수요일',`<div class="business-toolbar">${field('week','회의일','date',{value:meetingDate(today())})}${button('이전 회의','data-prev-meeting')}${button('다음 회의','data-next-meeting')}<output data-query-range class="weekly-range"></output>${button('새로 조회','data-refresh')}${button('회의용 확대','data-meeting')}</div><div data-list></div><details class="card weekly-legacy" data-legacy hidden><summary>기준일 확인이 필요한 기존 기록 (<span data-legacy-count>0</span>)</summary><p>원래 기준일을 복원할 수 없어 보고기간에 포함하지 않은 기록입니다. 기존 주간 정보를 보존했습니다.</p><div data-legacy-list></div></details><details class="card" open data-editor><summary>등록 · 수정</summary><form class="business-form weekly-form">${fields.map(f=>field(...f)).join('')}<div class="wide business-toolbar"><button class="btn primary" type="submit">저장</button>${button('신규','data-new')}</div></form></details><dialog class="weekly-detail" aria-labelledby="weeklyDetailTitle"><div data-detail-content></div><div class="business-toolbar">${button('닫기','data-close-detail')}</div></dialog>`);
  const form=$('form',root),dirty=protectForm(form),query=$('[name=week]',root),dialog=$('dialog',root);
  form.elements.date.insertAdjacentHTML('afterend','<output data-register-range class="weekly-range"></output>');
  form.elements.pnd.insertAdjacentHTML('afterend','<small data-pnd-original class="weekly-original" hidden></small>');
  let selected=null,records=[],legacy=[],newId=uid(),sequence=0;
  const owned=r=>button('상세',`data-detail="${esc(r.id)}"`)+(editable(r)?button('수정',`data-edit="${esc(r.id)}"`)+button('개별 삭제',`data-delete="${esc(r.id)}"`):'');
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
    const request=++sequence,day=query.value;let response;
    try{response=await api('weekly?week='+encodeURIComponent(day));}catch(error){if(request!==sequence||query.value!==day)return false;throw error;}
    if(request!==sequence||query.value!==day)return false;
    records=response.records;legacy=response.legacyRecords||[];
    $('[data-query-range]',root).textContent=rangeText(day);
    $('[data-list]',root).innerHTML=table(columns,records,owned);
    $('[data-legacy]',root).hidden=!legacy.length;$('[data-legacy-count]',root).textContent=legacy.length;
    $('[data-legacy-list]',root).innerHTML=table([{label:'기존 주간 정보',value:legacyWeek},...columns.slice(1)],legacy,owned);
    return true;
  }
  function showOriginal(record){const original=pndOriginal(record),node=$('[data-pnd-original]',root);node.hidden=!original;node.textContent=original?'기존 PND 원문: '+original+'\n날짜를 변경하지 않으면 원문을 유지합니다.':'';}
  function fill(record){
    selected=record;form.reset();
    for(const [key]of fields)form.elements[key].value=key==='date'?record.referenceDate||'':key==='pnd'?pndDate(record.pnd):key==='planAction'?combinedPlan(record):record[key]??'';
    form.elements.date.required=!record.unresolvedWeek;
    for(const key of ['product','manager','problem'])form.elements[key].required=Boolean(record[key]?.trim());
    showOriginal(record);hint();dirty.clean();
    $('[data-editor]',root).open=true;form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function reset(){selected=null;newId=uid();form.reset();for(const [key,,,opts]of fields)form.elements[key].required=Boolean(opts?.required);form.elements.date.value=query.value||meetingDate(today());showOriginal({});hint();dirty.clean();}
  function detail(record){
    const rows=[['회의일 · 보고기간',columns[0].value(record)],...(record.referenceDate&&record.referenceDate!==record.meetingDate?[['기존 기준일',record.referenceDate]]:[]),...(record.unresolvedWeek?[['기존 주간 정보',legacyWeek(record)]]:[]),...(record.legacyDate?[['기존 기준일 원문',record.legacyDate]]:[]),...(record.legacySqlDay?[['기존 주간 원문',record.legacySqlDay]]:[]),...columns.slice(1).map(c=>[c.label,c.value?c.value(record):record[c.key]]),...(pndOriginal(record)?[['기존 PND 원문',pndOriginal(record)]]:[])];
    $('[data-detail-content]',root).innerHTML='<h2 id="weeklyDetailTitle">주간 이슈 상세</h2><dl>'+rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd></div>`).join('')+'</dl>'+(editable(record)?button('수정',`data-detail-edit="${esc(record.id)}"`):'');
    if(!dialog.open)dialog.showModal();
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.hasAttribute('data-refresh'))void run(root,b,load);
    if(b.hasAttribute('data-prev-meeting')||b.hasAttribute('data-next-meeting')){const day=meetingDate(query.value||today());query.value=new Date(Date.parse(day+'T00:00:00Z')+(b.hasAttribute('data-prev-meeting')?-7:7)*86400000).toISOString().slice(0,10);query.dispatchEvent(new Event('change'));}
    if(b.hasAttribute('data-meeting')){root.classList.toggle('meeting-view');b.textContent=root.classList.contains('meeting-view')?'확대 닫기':'회의용 확대';}
    if(b.hasAttribute('data-new')&&dirty.replace())reset();
    if(b.hasAttribute('data-close-detail'))dialog.close();
    if(b.dataset.detail){const r=find(b.dataset.detail);if(r)detail(r);}
    const id=b.dataset.edit||b.dataset.detailEdit;
    if(id&&dirty.replace()){const r=find(id);if(r){dialog.close();fill(r);}}
    if(b.dataset.delete&&confirm('이 기록 한 건을 삭제하시겠습니까?'))void run(root,b,async()=>{const row=find(b.dataset.delete);await api('weekly/'+row.id,jsonOptions('DELETE',{revision:row.revision}));if(selected?.id===row.id)reset();message(root,'서버에서 개별 삭제를 확인했습니다.');await load();});
  });
  form.elements.date.addEventListener('input',hint);form.elements.date.addEventListener('change',()=>{if(weeklyDate(form.elements.date.value)&&(!selected||form.elements.date.value!==selected.referenceDate))form.elements.date.value=meetingDate(form.elements.date.value);hint();form.dispatchEvent(new Event('input',{bubbles:true}));});
  query.addEventListener('change',()=>{if(weeklyDate(query.value)){query.value=meetingDate(query.value);if(!selected&&form.dataset.dirty!=='true'){form.elements.date.value=query.value;hint();dirty.clean();}}void run(root,null,load);});
  root.addEventListener('hpm:restore-state',()=>void run(root,null,load));
  root.addEventListener('hpm:weekly-record',e=>void run(root,null,async()=>{if(e.detail.date)query.value=e.detail.date;if(await load()){const r=find(e.detail.id);if(r){if(r.unresolvedWeek)$('[data-legacy]',root).open=true;detail(r);}}}));
  form.addEventListener('submit',e=>{
    e.preventDefault();const draft=Object.fromEntries(new FormData(form));
    if(selected)for(const [key,value]of Object.entries(draft)){
      const before=key==='date'?selected.referenceDate||'':key==='pnd'?pndDate(selected.pnd):key==='planAction'?combinedPlan(selected):selected[key]??'';
      if(value===before)delete draft[key];
    }
    void run(root,$('[type=submit]',form),async()=>{
      const result=await api('weekly/'+(selected?.id||newId),jsonOptions('PUT',{...draft,revision:selected?.revision||0}));
      fill(result.record);message(root,'저장했습니다.');
      if(result.record.referenceDate)query.value=result.record.referenceDate;
      await load();
    });
  });
  hint();await run(root,null,load);
}
