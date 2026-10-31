import {$,api,esc,field,table,button,run,message,shell} from './common.js';
import {productionImportPanel,wireProductionImports} from './production-import.js?v=20261031-production';
import {xlsxClient} from './xlsx-client.js?v=20261031-production';
import {productionEquipment} from '../domain.mjs';
import {processStateLabels} from '../production-view.mjs?v=20261031-production';

const koreanTime=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' (한국시간)':'미등록';
const emptySelection=()=>({equipment:'',process:null,status:'all',risk:'all'});
const cardLabels={total:'전체 계획',active:'진행 중',ready:'납품준비·완료',overdue:'PND 경과 미완료',upcoming:'7일 이내 예정',unknown:'공정 미분류'};
export async function init(root){
  shell(root,'생산 일정관리','자료를 반영하고 생산 현황과 우선 확인 대상을 조회합니다.',`${productionImportPanel()}<p data-production-progress role="status" aria-live="polite"></p><form class="card production-filters" data-filters><div class="production-filter-main">${field('q','검색','search')}${field('equipment','장비 구분','select',{values:[['','전체']]})}<button type="submit" class="btn primary">조회</button>${button('전체 조건 해제','data-clear-filters')}</div><details data-filter-panel><summary>상세 필터</summary><div class="business-form">${['Yard','현공정','작업장'].map(k=>field(k,k,'select',{values:[['','전체']]})).join('')}${field('from','PND 시작','date')}${field('to','PND 종료','date')}</div></details></form><section data-summary tabindex="-1" aria-label="핵심 현황 건수"></section><section data-process aria-label="장비별 현황"></section><section data-list aria-label="선택 조건의 상세 목록"></section>`);
  let batch='',all=[],equipment='',view={records:[],groups:[]},page=0,meta=null,epoch=0,viewEpoch=0,closed=false,selection=emptySelection(),filterTimer;
  const engine=xlsxClient(),form=$('[data-filters]',root),columns=['PND',{label:'장비',value:r=>productionEquipment(r,equipment)},'Yard',{label:'Hull No.',key:'HullNo'},'LINE 5000','현공정','작업장','수량','FAT','Work Order'];
  const active=()=>root.isConnected&&!closed,filters=()=>Object.fromEntries(new FormData(form));
  let appliedFilters=filters();
  function renderList(){
    const selected=view.selection,conditions=[];
    for(const [key,value]of Object.entries(appliedFilters))if(value)conditions.push(button(`${{q:'검색',equipment:'장비',from:'PND 시작',to:'PND 종료'}[key]||key}: ${value} ×`,`data-clear-filter="${esc(key)}"`));
    if(selected.equipment)conditions.push(button('선택 장비: '+selected.equipment+' ×','data-clear-condition="equipment"'));
    if(selected.process!==null)conditions.push(button('세부 공정: '+(selected.process||'공정값 없음')+' ×','data-clear-condition="process"'));
    if(selected.status!=='all')conditions.push(button(processStateLabels[selected.status]+' ×','data-clear-condition="status"'));
    if(selected.risk!=='all')conditions.push(button((selected.risk==='overdue'?'PND 경과':'7일 이내 예정')+' ×','data-clear-condition="risk"'));
    $('[data-list]',root).innerHTML=`<div class="production-list-heading"><h2>조회 결과 ${view.records.length}건</h2>${button('선택 조건 해제','data-clear-selection')}</div><div class="production-tabs" role="group" aria-label="PND 목록 구분">${[['all','전체'],['overdue','PND 경과'],['upcoming','7일 이내 예정']].map(([key,label])=>button(label,`data-risk-tab="${key}" aria-pressed="${selected.risk===key}"`)).join('')}</div><div class="production-conditions" aria-label="현재 조회 조건">${conditions.join('')||'<span>전체 자료</span>'}</div>${table(columns,view.records.slice(page*100,(page+1)*100))}<div class="business-toolbar">${page?button('이전 100건','data-plan-prev'):''}<span>${view.records.length?page*100+1:0}~${Math.min((page+1)*100,view.records.length)} / ${view.records.length}건</span>${(page+1)*100<view.records.length?button('다음 100건','data-plan-next'):''}</div>`;
  }
  function render(){
    selection=view.selection;const s=view.summary;
    $('[data-summary]',root).innerHTML=`<div class="production-summary-heading"><h2>핵심 현황</h2><span>${selection.equipment?esc(selection.equipment)+(selection.process!==null?' · '+esc(selection.process||'공정값 없음'):''):'검색·필터 기준'} · 건수 기준</span></div><div class="production-kpis">${['total','active','ready','overdue','upcoming',...(s.unknown?['unknown']:[])].map(key=>`<button type="button" class="card production-kpi" data-kpi="${key}" aria-pressed="${key==='total'?selection.status==='all'&&selection.risk==='all':['overdue','upcoming'].includes(key)?selection.risk===key:selection.status===key&&selection.risk==='all'}"><span>${cardLabels[key]}</span><strong>${s[key]}<small>건</small></strong></button>`).join('')}</div><p class="production-count-note">전체 ${s.total} = 진행 중 ${s.active} + 납품준비·완료 ${s.ready}${s.unknown?' + 공정 미분류 '+s.unknown:''}건. PND 경과·7일 이내 예정은 진행 중 건의 일부입니다.</p><details class="production-count-guide"><summary>집계 기준 · PND 제외 ${s.missingPnd+s.invalidPnd}건</summary><p>한국 날짜 ${esc(view.today)} 기준 · 경과: 오늘 이전 · 예정: 오늘~7일 후, 양 끝 포함. PND 누락 ${s.missingPnd}건·해석 불가 ${s.invalidPnd}건은 날짜 지표에서 제외합니다.</p><p>납품준비·완료는 현재 공정의 납품준비 [APR] 분류입니다. 실제 출하나 납기 준수를 뜻하지 않습니다. 확인되지 않은 공정은 미분류로 표시합니다. 제품 수량은 상세 표에서 별도로 확인합니다.</p></details>`;
    const groups=view.groups,max=Math.max(10,Math.ceil(Math.max(0,...groups.map(g=>g.total))/10)*10),selectedGroup=groups.find(g=>g.name===selection.equipment);
    $('[data-process]',root).innerHTML=`<div class="card production-chart"><div class="production-list-heading"><h2>장비별 현황 <small>합계 ${view.baseCount}건</small></h2>${button('장비 선택 해제','data-clear-device')}</div><p class="hint">검색·필터 기준 공정 분포 · 장비를 선택하면 세부 공정을 확인합니다.</p><div class="production-legend">${['active','ready','unknown'].map(key=>`<span><i class="production-state-${key}"></i>${processStateLabels[key]}</span>`).join('')}</div><div class="production-axis"><span>0</span><span>${max/2}</span><span>${max}건</span></div>${groups.map((g,index)=>`<div class="production-chart-row ${selection.equipment===g.name?'selected':''}"><div class="production-device-label">${button(g.name,`data-device="${index}" aria-pressed="${selection.equipment===g.name}"`)}${g.overdue?`<button type="button" class="production-overdue" data-overdue-device="${index}" aria-label="${esc(g.name)} PND 경과 미완료 ${g.overdue}건">경과 ${g.overdue}</button>`:''}</div><div class="production-track" role="group" aria-label="${esc(g.name)} 총 ${g.total}건">${['active','ready','unknown'].filter(key=>g[key]).map(key=>`<button type="button" class="production-state-${key}" data-device="${index}" data-device-status="${key}" style="width:${g[key]/max*100}%" title="${esc(g.name+' '+processStateLabels[key]+' '+g[key]+'건')}" aria-label="${esc(g.name+' '+processStateLabels[key]+' '+g[key]+'건 선택')}">${g[key]}</button>`).join('')}</div><strong class="production-device-total">${g.total}<small>건</small></strong></div>`).join('')||'<p>장비별 데이터가 없습니다.</p>'}${selectedGroup?`<section class="production-step-detail" aria-label="선택 장비의 세부 공정"><h3>${esc(selectedGroup.name)} · 세부 공정별 건수</h3>${selectedGroup.steps.map((step,index)=>`<button type="button" class="production-step" data-step="${index}" aria-pressed="${selection.process===step.name}"><span>${esc(step.name||'공정값 없음')}</span><span class="production-step-track"><i style="width:${step.count/Math.max(1,selectedGroup.steps[0].count)*100}%"></i></span><strong>${step.count}건</strong></button>`).join('')}</section>`:''}</div>`;
    renderList();
  }
  async function apply(reset=false){
    const chosen=filters();if(chosen.from&&chosen.to&&chosen.from>chosen.to)throw Error('PND 종료일은 시작일 이후여야 합니다.');
    const request=++viewEpoch,result=await engine.call('view',{records:all,filters:chosen,equipment,selection:reset?emptySelection():selection});if(request!==viewEpoch||!active())return;
    view=result;appliedFilters=chosen;page=0;message(root,'');$('[data-production-progress]',root).textContent='';render();
  }
  async function load(){
    if(!active())return;const request=++epoch;++viewEpoch;
    const progress=$('[data-production-progress]',root);progress.textContent='최신 자료 확인 중…';
    try{
      const {record}=await api('imports/latest?kind=production');if(request!==epoch||!active())return;
      const candidate=[];let response=null,offset=0;const ids=new Set();
      if(record)do{
        response=await api('production?import='+encodeURIComponent(record.id)+'&offset='+offset);if(request!==epoch||!active())return;
        if(response.importId!==record.id||response.imported?.row_count!==record.row_count)throw Error('자료 버전이 달라 다시 조회해야 합니다.');
        for(const row of response.records){if(ids.has(row.id))throw Error('중복된 조회 응답입니다. 다시 조회하세요.');ids.add(row.id);candidate.push(row);}
        const next=response.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('조회 위치를 확인할 수 없습니다.');offset=next;
        progress.textContent=`조회 ${candidate.length}/${record.row_count}건`;await new Promise(resolve=>requestAnimationFrame(resolve));
      }while(offset!=null);
      if(record&&candidate.length!==record.row_count)throw Error('전체 행 조회를 완료하지 못했습니다.');
      const nextMeta=response?.version===2?response.meta:null,nextEquipment=nextMeta?.equipment||['제조사양관리구분','분류','LINE 5000'].find(k=>candidate.some(r=>Object.hasOwn(r,k)))||'';
      const chosen=filters(),options={};for(const k of ['equipment','Yard','현공정','작업장']){options[k]=[...new Set(candidate.map(r=>k==='equipment'?productionEquipment(r,nextEquipment):r[k]).filter(Boolean))].sort();if(!options[k].includes(chosen[k]))chosen[k]='';}
      if(chosen.from&&chosen.to&&chosen.from>chosen.to)throw Error('PND 종료일은 시작일 이후여야 합니다.');
      const viewRequest=++viewEpoch,result=await engine.call('view',{records:candidate,filters:chosen,equipment:nextEquipment,selection});if(request!==epoch||viewRequest!==viewEpoch||!active())return;
      const nextPage=record?.id===batch?page:0;
      batch=record?.id||'';all=candidate;meta=nextMeta;equipment=nextEquipment;view=result;page=Math.max(0,Math.min(nextPage,Math.ceil(view.records.length/100)-1));appliedFilters=chosen;
      for(const[k,values]of Object.entries(options)){const select=$(`[name="${k}"]`,root);select.innerHTML='<option value="">전체</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');select.value=chosen[k];}
      $('[data-current]',root).innerHTML=record?`<span>${esc(record.filename)}</span><span>${esc(koreanTime(record.applied_at))}</span><span>전체 ${record.row_count}건</span>`:'<span>반영된 생산자료가 없습니다.</span>';
      message(root,'');render();progress.textContent='';root.dataset.importId=batch;
    }catch(e){if(request===epoch&&active()){progress.textContent='조회 실패 · 기존 자료를 유지합니다. 새로 조회로 재시도하세요.';throw e;}}
  }
  form.onsubmit=e=>{e.preventDefault();clearTimeout(filterTimer);void run(root,$('[type=submit]',form),()=>apply(true));};
  form.addEventListener('input',e=>{if(e.target.name==='q'){clearTimeout(filterTimer);filterTimer=setTimeout(()=>void run(root,null,()=>apply(true)),220);}});
  form.addEventListener('change',()=>{clearTimeout(filterTimer);void run(root,null,()=>apply(true));});
  $('[data-refresh-production]',root).onclick=e=>void run(root,e.currentTarget,load);
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    let update=false;
    if(b.hasAttribute('data-clear-filters')){clearTimeout(filterTimer);form.reset();selection=emptySelection();update=true;}
    if(b.dataset.clearFilter){form.elements[b.dataset.clearFilter].value='';selection=emptySelection();update=true;}
    if(b.hasAttribute('data-clear-selection')){selection=emptySelection();update=true;}
    if(b.hasAttribute('data-clear-device')){selection={...selection,equipment:'',process:null};update=true;}
    if(b.dataset.clearCondition){const key=b.dataset.clearCondition;selection={...selection,[key]:key==='process'?null:key==='equipment'?'':'all'};if(key==='equipment')selection.process=null;update=true;}
    if(b.dataset.kpi){const key=b.dataset.kpi;selection={...selection,status:['active','ready','unknown'].includes(key)?key:'all',risk:['overdue','upcoming'].includes(key)?key:'all'};update=true;}
    if(b.dataset.riskTab){selection={...selection,risk:b.dataset.riskTab,status:'all'};update=true;}
    if(b.dataset.device!==undefined||b.dataset.overdueDevice!==undefined){const g=view.groups[Number(b.dataset.device??b.dataset.overdueDevice)];selection={equipment:g.name,process:null,status:b.dataset.deviceStatus||'all',risk:b.dataset.overdueDevice!==undefined?'overdue':'all'};update=true;}
    if(b.dataset.step!==undefined){const g=view.groups.find(g=>g.name===selection.equipment);selection={...selection,process:g.steps[Number(b.dataset.step)].name,status:'all',risk:'all'};update=true;}
    if(update)void run(root,null,async()=>{await apply();if(b.dataset.kpi||b.dataset.riskTab||b.dataset.step!==undefined||b.dataset.overdueDevice!==undefined||b.dataset.deviceStatus)$('[data-list]',root).scrollIntoView({block:'start',behavior:'smooth'});});
    if(b.hasAttribute('data-plan-next')){page=Math.min(page+1,Math.max(0,Math.ceil(view.records.length/100)-1));renderList();}
    if(b.hasAttribute('data-plan-prev')){page=Math.max(0,page-1);renderList();}
  });
  $('[data-export]',root).onclick=e=>void run(root,e.currentTarget,async()=>{
    if(!batch)throw Error('반영된 생산자료가 없습니다.');const exportBatch=batch,exportMeta=meta,wanted=new Set(view.records.map(r=>r.id)),snapshot=view.records.slice();
    let rows,exportColumns;
    if(!exportMeta){exportColumns=[...new Set(all.flatMap(r=>Object.keys(r)))].filter(k=>k!=='id'&&!k.startsWith('__'));rows=snapshot.map(r=>exportColumns.map(k=>r[k]??''));}
    else{rows=[];exportColumns=exportMeta.columns;let offset=0;do{const r=await api('imports/'+exportBatch+'/rows?offset='+offset);for(const row of r.records)if(wanted.has(exportBatch+'_'+row.number))rows.push(row.values);const next=r.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('다운로드 조회 위치를 확인하세요.');offset=next;if(!active())return;$('[data-production-progress]',root).textContent=`다운로드 준비 ${rows.length}/${wanted.size}건`;await new Promise(resolve=>requestAnimationFrame(resolve));}while(offset!=null);}
    if(rows.length!==wanted.size)throw Error('다운로드 자료 조회가 불완전합니다. 다시 시도하세요.');const result=await engine.call('export',{columns:exportColumns,rows,date1904:exportMeta?.date1904||false});if(!active())return;
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='생산일정_조회결과.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('[data-production-progress]',root).textContent=`엑셀 다운로드 ${rows.length}건 · 현재 조건의 전체 결과`;
  });
  await wireProductionImports(root,async()=>{await load();$('[data-summary]',root).focus({preventScroll:true});});
  root.hpmGetState=()=>({page,selection});root.hpmLoadState=async()=>{};
  root.hpmRestoreState=async saved=>{selection=saved?.selection||emptySelection();await run(root,null,async()=>{await apply();page=Math.max(0,Math.min(saved?.page||0,Math.ceil(view.records.length/100)-1));renderList();});};
  await run(root,null,load);
  const refresh=()=>{if(active()&&root.classList.contains('active')&&!document.hidden&&root.getAttribute('aria-busy')!=='true'&&root.dataset.importBusy!=='true')void run(root,null,load);};
  const navigate=e=>{if(e.detail==='production')refresh();};const timer=setInterval(refresh,60000);
  document.addEventListener('hpm:navigate',navigate);window.addEventListener('focus',refresh);
  const clear=()=>{if(!root.isConnected||!window.hpmServerUser){closed=true;epoch++;viewEpoch++;clearTimeout(filterTimer);engine.close();clearInterval(timer);document.removeEventListener('hpm:navigate',navigate);window.removeEventListener('focus',refresh);document.removeEventListener('hpm:auth',clear);}};document.addEventListener('hpm:auth',clear);
}
