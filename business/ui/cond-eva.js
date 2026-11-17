import {$,api,esc,shell,user} from './common.js';
import {processFields,filterOrders,summary,validDate,koreaTime} from '../cond-eva-view.mjs';
export async function init(root){
  const owner=user()?.id,alive=()=>root.isConnected&&user()?.id===owner;
  let snapshot=null,page=0,busy=false;
  shell(root,'COND/EVA 생산현황','원본 프로그램에 저장된 생산계획과 공정 날짜를 조회합니다.',`
    <form class="card cond-eva-search" role="search"><label>호선·작업지시번호·프로젝트·장비 검색<input type="search" name="q" maxlength="200" placeholder="검색어 입력" autocomplete="off"></label><button class="btn primary" type="submit">검색</button><button class="btn outline" type="button" data-cond-clear>검색 초기화</button><button class="btn outline" type="button" data-cond-refresh>새로고침</button></form>
    <p data-cond-status role="status" aria-live="polite">생산현황을 조회하고 있습니다.</p>
    <section data-cond-results hidden><p class="hint" data-cond-time></p><div class="cond-eva-summary" data-cond-summary></div>
    <p class="hint">현재 검색 조건의 날짜 등록 건수·비율입니다. SHELL은 요청일이며 완료일을 뜻하지 않습니다. 납기 지연·준수율은 산정하지 않습니다.</p>
    <p data-cond-count></p><p data-cond-invalid class="hint" hidden></p><div data-cond-table></div>
    <div class="business-toolbar cond-eva-pages"><button class="btn outline" type="button" data-cond-prev>이전</button><span data-cond-page></span><button class="btn outline" type="button" data-cond-next>다음</button></div></section>`);
  root.classList.add('cond-eva-page');
  const form=$('form',root),status=$('[data-cond-status]',root);
  function render(){
    if(!snapshot)return;const rows=filterOrders(snapshot.items,form.elements.q.value),stats=summary(rows),pages=Math.max(1,Math.ceil(rows.length/100));page=Math.min(page,pages-1);
    $('[data-cond-results]',root).hidden=false;
    $('[data-cond-time]',root).textContent=`마지막 조회 성공: ${koreaTime(snapshot.fetchedAt)} (한국시간) · 원본 데이터 최종 수정: ${snapshot.sourceUpdatedAt?koreaTime(snapshot.sourceUpdatedAt)+' (한국시간)':'미제공'}`;
    $('[data-cond-summary]',root).innerHTML=`<div class="card"><span>현재 검색 대상</span><strong>${rows.length.toLocaleString('ko-KR')}건</strong><small>전체 계획 ${snapshot.total.toLocaleString('ko-KR')}건</small></div>`+stats.map(s=>`<div class="card"><span>${esc(s.label)}</span><strong>${s.registered.toLocaleString('ko-KR')}건</strong><small>${s.total?s.rate.toLocaleString('ko-KR',{maximumFractionDigits:1})+'% · '+s.total.toLocaleString('ko-KR')+'건 중':'산정 대상 없음'}</small></div>`).join('');
    $('[data-cond-count]',root).textContent=`검색 결과 ${rows.length.toLocaleString('ko-KR')}건 / 전체 ${snapshot.total.toLocaleString('ko-KR')}건 · 전체 페이지 수신 확인`;
    const invalid=stats.reduce((sum,s)=>sum+s.invalid,0),note=$('[data-cond-invalid]',root);note.hidden=!invalid;note.textContent=`날짜 형식 확인이 필요한 값 ${invalid}개는 원문을 표시하고 등록 비율에서 제외했습니다.`;
    const date=value=>value==null||!String(value).trim()?'<span class="cond-eva-missing">미등록</span>':validDate(value)?esc(value):`<span class="cond-eva-invalid">${esc(value)}<small>날짜 확인 필요</small></span>`;
    $('[data-cond-table]',root).innerHTML=`<div class="business-table-wrap" tabindex="0" role="region" aria-label="COND/EVA 생산현황 표"><table class="business-table"><thead><tr>${['호선','작업지시번호','프로젝트','장비',...processFields.map(p=>p[1])].map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.slice(page*100,(page+1)*100).map(row=>`<tr>${['hull','work_order','project','equipment'].map(key=>`<td>${esc(row[key]||'—')}</td>`).join('')}${processFields.map(([key])=>`<td>${date(row[key])}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="13">현재 조건에 해당하는 생산계획이 없습니다.</td></tr>'}</tbody></table></div>`;
    $('[data-cond-page]',root).textContent=`${page+1} / ${pages}페이지 · 페이지당 100건`;$('[data-cond-prev]',root).disabled=page===0;$('[data-cond-next]',root).disabled=page===pages-1;
  }
  async function load(){
    if(busy)return;busy=true;root.setAttribute('aria-busy','true');$('[data-cond-refresh]',root).disabled=true;status.classList.remove('error');status.textContent=snapshot?'새 현황 조회 중 · 아래는 마지막 성공 결과입니다.':'생산현황을 조회하고 있습니다.';
    try{
      const result=await api('cond-eva',{timeoutMs:25000});if(!alive())return;
      if(result.complete!==true||!Array.isArray(result.items)||result.total!==result.items.length||!Number.isFinite(Date.parse(result.fetchedAt)))throw Error('전체 조회가 완료되지 않았습니다.');
      snapshot=result;page=0;render();status.textContent=`전체 ${result.total.toLocaleString('ko-KR')}건 조회 완료`;
    }catch(error){if(alive()){status.classList.add('error');status.textContent=error.message+(snapshot?` 마지막 성공 결과를 유지합니다 (${koreaTime(snapshot.fetchedAt)}, 한국시간).`:' 조회 결과가 없으며 0건을 의미하지 않습니다.');}}
    finally{busy=false;if(alive()){root.setAttribute('aria-busy','false');$('[data-cond-refresh]',root).disabled=false;}}
  }
  form.onsubmit=e=>{e.preventDefault();page=0;render();};form.elements.q.oninput=()=>{page=0;render();};
  $('[data-cond-clear]',root).onclick=()=>{form.reset();page=0;render();};$('[data-cond-refresh]',root).onclick=()=>void load();
  $('[data-cond-prev]',root).onclick=()=>{page--;render();};$('[data-cond-next]',root).onclick=()=>{page++;render();};
  await load();
}
