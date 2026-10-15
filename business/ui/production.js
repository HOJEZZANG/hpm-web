import {$,api,esc,field,table,button,run,message,download,shell} from './common.js';
import {importPanel,wireImports} from './imports.js';
export async function init(root){
  shell(root,'생산 일정관리','한국 날짜 기준 · 현공정에 납품준비 포함 = 완료 · PND 경과 미완료 = 지연 · 오늘부터 7일 이내 미완료 = 임박',`${importPanel('production')}<form class="business-form card" data-filters>${field('q','검색')}${field('equipment','장비 구분','select',{values:[['','전체']]})}${['Yard','현공정','작업장'].map(k=>field(k,k,'select',{values:[['','전체']]})).join('')}${field('from','PND 시작','date')}${field('to','PND 종료','date')}<div class="wide business-toolbar"><button type="submit" class="btn primary">필터 조회</button>${button('조회 결과 엑셀 다운로드','data-export')}</div></form><div data-summary></div><div data-process></div><details open><summary>PND 지연 · 7일 이내 임박</summary><div data-risk></div></details><div data-list></div>`);
  let batch='',all=[],query=new URLSearchParams(),equipmentColumn='제조사양관리구분';
  const columns=['PND',{label:'장비 구분',value:r=>r[equipmentColumn]},'Yard','HullNo','LINE 5000','현공정','작업장','수량','FAT','Work Order'];
  const load=async id=>{
    if(id!==undefined){batch=id;all=(await api('production?import='+batch)).records;equipmentColumn=['제조사양관리구분','분류','LINE 5000'].find(k=>all.some(r=>Object.hasOwn(r,k)));for(const k of ['equipment','Yard','현공정','작업장']){$(`[name="${k}"]`,root).innerHTML='<option value="">전체</option>'+[...new Set(all.map(r=>r[k==='equipment'?equipmentColumn:k]).filter(Boolean))].sort().map(v=>`<option>${esc(v)}</option>`).join('');}}
    query=new URLSearchParams(new FormData($('[data-filters]',root)));query.set('import',batch);const r=await api('production?'+query),s=r.summary;
    $('[data-summary]',root).innerHTML=`<div class="business-metrics"><span>계획 <strong>${s.count}</strong>건</span><span>수량 <strong>${s.quantity}</strong></span><span>PND <strong>${s.pndCount}</strong>건</span><span>원본식 완료 비율 <strong>${s.rate.toFixed(1)}%</strong> (${s.complete}/${s.due})</span></div><p>PND 기간 ${esc(s.pndStart||'미등록')} ~ ${esc(s.pndEnd||'미등록')} · 원본식 비율 = 완료 / (PND가 오늘까지이거나 완료인 유효 PND 건). 완료일 정보가 없어 실제 납기 준수 증빙으로 사용할 수 없습니다.</p>`;
    $('[data-process]',root).innerHTML=`<h2>장비별 공정 현황</h2>${Object.entries(s.equipment).map(([k,v])=>`<div class="card"><strong>${esc(k)}</strong> ${Object.entries(v).map(([p,n])=>`${esc(p)} ${n}건`).join(' / ')}</div>`).join('')||'<p>장비별 데이터가 없습니다.</p>'}`;
    $('[data-risk]',root).innerHTML=`<h3>지연 ${s.delayed.length}건</h3>${table(columns,s.delayed)}<h3>임박 ${s.imminent.length}건</h3>${table(columns,s.imminent)}`;
    $('[data-list]',root).innerHTML=`<h2>조회 결과 ${r.records.length}건</h2>${table(columns,r.records)}`;
  };
  $('[data-filters]',root).onsubmit=e=>{e.preventDefault();void run(root,$('[type=submit]',root),()=>load());};
  $('[data-export]',root).onclick=e=>void run(root,e.target,()=>{const q=new URLSearchParams(query);q.set('download','1');return download('production?'+q,'생산일정_조회결과.xlsx');});
  await wireImports(root,'production',load);await run(root,null,()=>load(''));
}
