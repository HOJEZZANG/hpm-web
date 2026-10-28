import {$,api,esc,field,table,button,run,download,shell} from './common.js';
import {productionImportPanel,wireProductionImports} from './production-import.js?v=20261028-dashboard';
import {xlsxClient} from './xlsx-client.js?v=20261028-dashboard';
import {productionEquipment} from '../domain.mjs?v=20261028-dashboard';

const koreanTime=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' (한국시간)':'미등록';
const reasonLabels={missingPnd:'PND 없음',invalidPnd:'PND 오류',notCompleted:'실제 완료일 미등록',missingCompletion:'완료 공정이나 실제 완료일 없음',invalidCompletion:'실제 완료일 오류',ambiguousCompletion:'완료일 열 확인 필요'};
export async function init(root){
  shell(root,'생산 일정관리','마지막으로 정상 반영된 생산자료를 모든 PC에서 함께 조회합니다.',`<div class="production-current card"><div data-current>최신 자료 확인 중…</div><div class="business-toolbar">${button('최신 자료 새로 조회','data-refresh-production')}${button('조회 결과 엑셀 다운로드','data-export')}</div></div><p data-production-progress role="status" aria-live="polite"></p><section data-summary tabindex="-1"></section><section data-process></section>${productionImportPanel()}<details class="card" data-filter-panel><summary>상세 필터</summary><form class="business-form" data-filters>${field('q','검색')}${field('equipment','장비 구분','select',{values:[['','전체']]})}${['Yard','현공정','작업장'].map(k=>field(k,k,'select',{values:[['','전체']]})).join('')}${field('from','PND 시작','date')}${field('to','PND 종료','date')}<div class="wide business-toolbar"><button type="submit" class="btn primary">필터 조회</button>${button('필터 초기화','data-clear-filters')}</div></form></details><details class="card"><summary data-risk-title>PND 지연 · 7일 이내 임박</summary><div data-risk></div></details><div data-list></div>`);
  let batch='',all=[],equipment='',view={records:[]},page=0,meta=null,completionFieldState,epoch=0,viewEpoch=0,closed=false;
  const engine=xlsxClient(),columns=['PND',{label:'장비 구분',value:r=>productionEquipment(r,equipment)},'Yard','HullNo','LINE 5000','현공정','작업장','수량','FAT','Work Order'];
  const active=()=>root.isConnected&&!closed;
  const filters=()=>Object.fromEntries(new FormData($('[data-filters]',root)));
  function renderList(){
    $('[data-list]',root).innerHTML=`<h2>조회 결과 ${view.records.length}건</h2>${table(columns,view.records.slice(page*100,(page+1)*100))}<div class="business-toolbar">${page?button('이전 100건','data-plan-prev'):''}<span>${view.records.length?page*100+1:0}~${Math.min((page+1)*100,view.records.length)} / ${view.records.length}건</span>${(page+1)*100<view.records.length?button('다음 100건','data-plan-next'):''}</div>`;
  }
  function render(){
    const s=view.summary,a=s.adherence,percent=a.rate==null?(a.status==='unavailable'?'산정 불가':'산정 대상 없음'):a.rate.toFixed(1)+'%';
    $('[data-summary]',root).innerHTML=`<div class="production-kpis"><article class="card production-primary"><span>PND 준수율</span><strong data-adherence>${esc(percent)}</strong><p>PND 이내 완료 ${a.onTime} / 판정 가능 완료 ${a.eligible}건 · 기한 후 완료 ${a.late}건</p><p>${esc(a.reason||'실제 완료일이 PND 당일이거나 이전인 완료 건의 비율입니다.')}</p><details><summary>계산 기준 · 제외 ${a.excluded}건</summary><p>분모: 유효한 PND와 명시적인 실제 완료일이 모두 있는 건. 예정일·개별 공정 완료일은 사용하지 않습니다. 미완료 건은 제외하며 별도 지연 목록을 함께 확인하세요.</p>${Object.entries(a.reasons).map(([key,n])=>`<p>${reasonLabels[key]}: ${n}건</p>`).join('')}</details></article><article class="card"><span>조회 계획</span><strong>${s.count}<small>건</small></strong><p>총 수량 ${s.quantity} · 유효 PND ${s.pndCount}건</p><p>PND ${esc(s.pndStart||'미등록')} ~ ${esc(s.pndEnd||'미등록')}</p></article><article class="card"><span>공정 완료 비율 · 보조 지표</span><strong>${s.due?s.rate.toFixed(1)+'%':'대상 없음'}</strong><p>납품준비 포함 완료 ${s.complete} / 오늘까지 PND 또는 이미 완료 ${s.due}건</p><p>현재 공정으로 계산한 비율입니다.</p></article></div>`;
    const groups=Object.entries(s.equipment),steps=[...new Set(groups.flatMap(([,values])=>Object.keys(values)))].sort(),totals=Object.fromEntries(steps.map(p=>[p,groups.reduce((sum,[,v])=>sum+(v[p]||0),0)])),max=Math.max(1,...groups.map(([,v])=>Object.values(v).reduce((a,b)=>a+b,0)));
    $('[data-process]',root).innerHTML=`<div class="card production-chart"><h2>장비별 공정 현황 <small>합계 ${s.count}건</small></h2><p class="hint">공정 구간을 선택하면 해당 장비·공정의 상세 목록으로 이동합니다. 건수 기준입니다.</p><div class="production-legend">${steps.map((p,i)=>`<span><i style="background:var(--process-${i%8})"></i>${esc(p)} ${totals[p]}건</span>`).join('')}</div>${groups.map(([name,values],g)=>{const total=Object.values(values).reduce((a,b)=>a+b,0);return `<div class="production-chart-row"><strong>${esc(name)} <small>${total}건</small></strong><div class="production-track"><div class="production-stack" style="width:${total/max*100}%">${steps.filter(p=>values[p]).map(p=>`<button type="button" data-segment="${g}" data-step="${steps.indexOf(p)}" style="flex:${values[p]};background:var(--process-${steps.indexOf(p)%8})" title="${esc(name+' · '+p+' '+values[p]+'건')}" aria-label="${esc(name+' · '+p+' '+values[p]+'건 상세 보기')}">${values[p]}</button>`).join('')}</div></div><p>${Object.entries(values).map(([p,n])=>`${esc(p)} ${n}건`).join(' · ')}</p></div>`;}).join('')||'<p>장비별 데이터가 없습니다.</p>'}</div>`;
    $('[data-process]',root).onclick=e=>{const b=e.target.closest('[data-segment]');if(!b)return;$('[name=equipment]',root).value=groups[Number(b.dataset.segment)][0];$('[name="현공정"]',root).value=steps[Number(b.dataset.step)];$('[data-filter-panel]',root).open=true;void run(root,null,async()=>{await apply();$('[data-list]',root).scrollIntoView({block:'start',behavior:'smooth'});});};
    $('[data-risk-title]',root).textContent=`PND 지연 ${s.delayed.length}건 · 7일 이내 임박 ${s.imminent.length}건`;
    $('[data-risk]',root).innerHTML=`<h3>미완료 PND 경과 ${s.delayed.length}건</h3>${table(columns,s.delayed.slice(0,50))}<h3>오늘~7일 이내 미완료 ${s.imminent.length}건</h3>${table(columns,s.imminent.slice(0,50))}<p class="hint">한국 날짜 기준 · 납품준비 포함 공정은 완료로 분류합니다. 각 목록은 처음 50건입니다. 전체 자료는 상세 필터와 다운로드에서 확인하세요.</p>`;
    renderList();
  }
  async function apply(){
    const selected=filters();if(selected.from&&selected.to&&selected.from>selected.to)throw Error('PND 종료일은 시작일 이후여야 합니다.');
    const request=++viewEpoch,result=await engine.call('view',{records:all,filters:selected,equipment,completionFieldState});if(request!==viewEpoch||!active())return;
    view=result;page=0;render();
  }
  async function load(){
    if(!active())return;const request=++epoch;++viewEpoch;
    const progress=$('[data-production-progress]',root);progress.textContent='최신 정상 반영 자료 확인 중…';
    try{
      const {record}=await api('imports/latest?kind=production');if(request!==epoch||!active())return;
      const candidate=[];let response=null,offset=0;const ids=new Set();
      if(record)do{
        response=await api('production?import='+encodeURIComponent(record.id)+'&offset='+offset);if(request!==epoch||!active())return;
        if(response.importId!==record.id||response.imported?.row_count!==record.row_count)throw Error('자료 버전이 달라 다시 조회해야 합니다.');
        for(const row of response.records){if(ids.has(row.id))throw Error('중복된 조회 응답입니다. 다시 조회하세요.');ids.add(row.id);candidate.push(row);}
        const next=response.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('조회 위치를 확인할 수 없습니다.');offset=next;
        progress.textContent=`서버 조회 ${candidate.length}/${record.row_count}행`;await new Promise(resolve=>requestAnimationFrame(resolve));
      }while(offset!=null);
      if(record&&candidate.length!==record.row_count)throw Error('전체 행 조회를 완료하지 못했습니다.');
      const nextMeta=response?.meta||null,nextEquipment=nextMeta?.equipment||['제조사양관리구분','분류','LINE 5000'].find(k=>candidate.some(r=>Object.hasOwn(r,k)))||'',nextState=response?.completionFieldState;
      const selected=filters(),options={};for(const k of ['equipment','Yard','현공정','작업장']){options[k]=[...new Set(candidate.map(r=>k==='equipment'?productionEquipment(r,nextEquipment):r[k]).filter(Boolean))].sort();if(!options[k].includes(selected[k]))selected[k]='';}
      if(selected.from&&selected.to&&selected.from>selected.to)throw Error('PND 종료일은 시작일 이후여야 합니다.');
      const result=await engine.call('view',{records:candidate,filters:selected,equipment:nextEquipment,completionFieldState:nextState});if(request!==epoch||!active())return;
      batch=record?.id||'';all=candidate;meta=nextMeta;equipment=nextEquipment;completionFieldState=nextState;view=result;page=0;
      for(const[k,values]of Object.entries(options)){const select=$(`[name="${k}"]`,root);select.innerHTML='<option value="">전체</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');select.value=selected[k];}
      $('[data-current]',root).innerHTML=record?`<strong>현재 반영 자료 · ${esc(record.filename)}</strong><p>${record.row_count}행 · ${esc(koreanTime(record.applied_at))}</p>`:'<strong>반영된 생산자료가 없습니다.</strong><p>관리자가 생산 엑셀을 반영하면 여기에 표시됩니다.</p>';
      render();progress.textContent=record?`최신 자료 조회 완료 · ${all.length}행`:'반영 자료 없음';root.dataset.importId=batch;
    }catch(e){if(request===epoch&&active()){progress.textContent='조회 실패 · 이전 화면과 자료를 유지합니다. 최신 자료 새로 조회로 재시도하세요.';throw e;}}
  }
  $('[data-filters]',root).onsubmit=e=>{e.preventDefault();void run(root,$('[type=submit]',root),apply);};
  $('[data-clear-filters]',root).onclick=()=>{$('[data-filters]',root).reset();void run(root,null,apply);};
  $('[data-refresh-production]',root).onclick=e=>void run(root,e.target,load);
  root.addEventListener('click',e=>{if(e.target.closest('[data-plan-next]')){page++;renderList();}if(e.target.closest('[data-plan-prev]')){page--;renderList();}});
  $('[data-export]',root).onclick=e=>void run(root,e.target,async()=>{
    if(!batch)throw Error('반영된 생산자료가 없습니다.');const exportBatch=batch,exportMeta=meta,wanted=new Set(view.records.map(r=>r.id));
    if(!exportMeta){const q=new URLSearchParams(filters());q.set('import',exportBatch);q.set('download','1');return download('production?'+q,'생산일정_조회결과.xlsx');}
    const rows=[];let offset=0;do{const r=await api('imports/'+exportBatch+'/rows?offset='+offset);for(const row of r.records)if(wanted.has(exportBatch+'_'+row.number))rows.push(row.values);offset=r.nextOffset;if(!active())return;$('[data-production-progress]',root).textContent=`다운로드 원본 조회 ${rows.length}행`;await new Promise(resolve=>requestAnimationFrame(resolve));}while(offset!=null);
    if(rows.length!==wanted.size)throw Error('다운로드 자료 조회가 불완전합니다. 다시 시도하세요.');const result=await engine.call('export',{columns:exportMeta.columns,rows});if(!active())return;
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='생산일정_조회결과.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('[data-production-progress]',root).textContent=`다운로드 준비 완료 · ${rows.length}행 · 원래 열 순서/제목 유지`;
  });
  await wireProductionImports(root,async()=>{await load();$('[data-summary]',root).focus({preventScroll:true});$('[data-summary]',root).scrollIntoView({block:'start',behavior:'smooth'});});
  root.hpmGetState=()=>({page});root.hpmLoadState=async()=>{};
  root.hpmRestoreState=async saved=>{await run(root,null,async()=>{await apply();page=Math.max(0,Math.min(saved?.page||0,Math.ceil(view.records.length/100)-1));renderList();});};
  await run(root,null,load);
  const refresh=()=>{if(active()&&root.classList.contains('active')&&!document.hidden&&root.getAttribute('aria-busy')!=='true')void run(root,null,load);};
  const navigate=e=>{if(e.detail==='production')refresh();};const timer=setInterval(refresh,60000);
  document.addEventListener('hpm:navigate',navigate);window.addEventListener('focus',refresh);
  const clear=()=>{if(!root.isConnected||!window.hpmServerUser){closed=true;epoch++;viewEpoch++;engine.close();clearInterval(timer);document.removeEventListener('hpm:navigate',navigate);window.removeEventListener('focus',refresh);document.removeEventListener('hpm:auth',clear);}};document.addEventListener('hpm:auth',clear);
}
