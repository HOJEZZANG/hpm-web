import {$,api,esc,field,table,button,run,message,download,shell} from './common.js';
import {importPanel,wireImports} from './imports.js?v=20261023';
import {xlsxClient} from './xlsx-client.js';
export async function init(root){
  shell(root,'생산 일정관리','한국 날짜 기준 · 납품준비 포함 = 완료 · 미완료 PND 경과 = 지연 · 오늘~7일 이내 = 임박',`${importPanel('production')}<form class="business-form card" data-filters>${field('q','검색')}${field('equipment','장비 구분','select',{values:[['','전체']]})}${['Yard','현공정','작업장'].map(k=>field(k,k,'select',{values:[['','전체']]})).join('')}${field('from','PND 시작','date')}${field('to','PND 종료','date')}<div class="wide business-toolbar"><button type="submit" class="btn primary">필터 조회</button>${button('조회 결과 엑셀 다운로드','data-export')}</div></form><p data-production-progress role="status"></p><div data-summary></div><div data-process></div><details open><summary>PND 지연 · 7일 이내 임박</summary><div data-risk></div></details><div data-list></div>`);
  let batch='',all=[],equipment='제조사양관리구분',view={records:[]},page=0,meta=null,epoch=0;
  const engine=xlsxClient(),columns=['PND',{label:'장비 구분',value:r=>r[equipment]},'Yard','HullNo','LINE 5000','현공정','작업장','수량','FAT','Work Order'];
  const renderList=()=>{$('[data-list]',root).innerHTML=`<h2>조회 결과 ${view.records.length}건</h2>${table(columns,view.records.slice(page*100,(page+1)*100))}<div class="business-toolbar">${page?button('이전 100건','data-plan-prev'):''}<span>${view.records.length?page*100+1:0}~${Math.min((page+1)*100,view.records.length)} / ${view.records.length}건</span>${(page+1)*100<view.records.length?button('다음 100건','data-plan-next'):''}</div>`;};
  async function apply(){
    const filters=Object.fromEntries(new FormData($('[data-filters]',root)));if(filters.from&&filters.to&&filters.from>filters.to)throw Error('PND 종료일은 시작일 이후여야 합니다.');
    view=await engine.call('view',{records:all,filters,equipment});page=0;const s=view.summary;
    $('[data-summary]',root).innerHTML=`<div class="business-metrics"><span>계획 <strong>${s.count}</strong>건</span><span>수량 <strong>${s.quantity}</strong></span><span>PND <strong>${s.pndCount}</strong>건</span><span>원본식 완료 비율 <strong>${s.rate.toFixed(1)}%</strong> (${s.complete}/${s.due})</span></div><p>PND ${esc(s.pndStart||'미등록')} ~ ${esc(s.pndEnd||'미등록')} · 완료 / (PND가 오늘까지이거나 완료인 유효 PND 건). 실제 납기 준수 증빙이 아닙니다.</p>`;
    $('[data-process]',root).innerHTML=`<h2>장비별 공정 현황</h2>${Object.entries(s.equipment).map(([name,steps])=>`<div class="card"><strong>${esc(name)}</strong> ${Object.entries(steps).map(([p,n])=>`${esc(p)} ${n}건`).join(' / ')}</div>`).join('')||'<p>장비별 데이터가 없습니다.</p>'}`;
    $('[data-risk]',root).innerHTML=`<h3>지연 ${s.delayed.length}건</h3>${table(columns,s.delayed.slice(0,50))}<h3>임박 ${s.imminent.length}건</h3>${table(columns,s.imminent.slice(0,50))}<p class="hint">각 목록은 처음 50건을 표시합니다. 전체 조회 결과에서 필터·페이지·다운로드를 이용하세요.</p>`;renderList();
  }
  const load=async id=>{
    if(id===undefined)return apply();const request=++epoch,candidate=[];let offset=0,next=null,response;
    try{do{response=await api('production?import='+encodeURIComponent(id)+'&offset='+offset);if(request!==epoch||!root.isConnected)return;candidate.push(...response.records);next=response.nextOffset;offset=next;$('[data-production-progress]',root).textContent=`서버 조회 ${candidate.length}/${response.total??candidate.length}행`;await new Promise(resolve=>requestAnimationFrame(resolve));}while(next!=null);
      batch=id;all=candidate;meta=response.meta||null;equipment=meta?.equipment||['제조사양관리구분','분류','LINE 5000'].find(k=>all.some(r=>Object.hasOwn(r,k)))||'제조사양관리구분';
      for(const k of ['equipment','Yard','현공정','작업장']){const select=$(`[name="${k}"]`,root),previous=select.value;select.innerHTML='<option value="">전체</option>'+[...new Set(all.map(r=>r[k==='equipment'?equipment:k]).filter(Boolean))].sort().map(v=>`<option>${esc(v)}</option>`).join('');select.value=[...select.options].some(o=>o.value===previous)?previous:'';}
      await apply();$('[data-production-progress]',root).textContent=id?`서버 조회 완료 · ${all.length}행`:'조회할 반영 이력을 선택하세요.';
    }catch(e){$('[name=batch]',root).value=batch;$('[data-production-progress]',root).textContent='조회 실패 · 이전 조회 자료를 유지합니다. 이력을 다시 선택하거나 새로 조회하세요.';throw e;}
  };
  $('[data-filters]',root).onsubmit=e=>{e.preventDefault();void run(root,$('[type=submit]',root),()=>apply());};
  root.addEventListener('click',e=>{if(e.target.closest('[data-plan-next]')){page++;renderList();}if(e.target.closest('[data-plan-prev]')){page--;renderList();}});
  $('[data-export]',root).onclick=e=>void run(root,e.target,async()=>{
    if(!batch)throw Error('반영 이력을 선택하세요.');if(!meta){const q=new URLSearchParams(new FormData($('[data-filters]',root)));q.set('import',batch);q.set('download','1');return download('production?'+q,'생산일정_조회결과.xlsx');}
    const wanted=new Set(view.records.map(r=>r.id)),rows=[];let offset=0;
    do{const r=await api('imports/'+batch+'/rows?offset='+offset);for(const row of r.records)if(wanted.has(batch+'_'+row.number))rows.push(row.values);offset=r.nextOffset;$('[data-production-progress]',root).textContent=`다운로드 원본 조회 ${offset??r.total}/${r.total}행`;await new Promise(resolve=>requestAnimationFrame(resolve));}while(offset!=null);
    const result=await engine.call('export',{columns:meta.columns,rows}),url=URL.createObjectURL(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='생산일정_조회결과.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('[data-production-progress]',root).textContent=`다운로드 준비 완료 · ${rows.length}행 · 원래 열 순서/제목 유지`;
  });
  const clear=()=>{if(!root.isConnected||!window.hpmServerUser){engine.close();if(!root.isConnected)document.removeEventListener('hpm:auth',clear);}};document.addEventListener('hpm:auth',clear);
  root.addEventListener('hpm:restore-state',()=>void run(root,null,()=>apply()));
  root.hpmGetState=()=>({batch,page});
  root.hpmLoadState=async saved=>{if(saved&&saved.batch!==batch){await run(root,null,()=>load(saved.batch));$('[name=batch]',root).value=batch;}};
  root.hpmRestoreState=async saved=>{await run(root,null,async()=>{await apply();page=Math.max(0,Math.min(saved?.page||0,Math.ceil(view.records.length/100)-1));renderList();});};
  await wireImports(root,'production',load);await run(root,null,()=>load(''));
}
