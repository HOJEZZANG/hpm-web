import {$,api,esc,table,button,run,message,download,isAdmin,jsonOptions} from './common.js';
import {xlsxClient} from './xlsx-client.js?v=20261031-production';
const FILE_LIMIT=10*1024*1024;
export function productionImportPanel(){return `<details class="card production-import" data-import-panel open><summary>생산자료 반영</summary><div class="production-current" data-current>최신 자료 확인 중…</div>${isAdmin()?`<div class="production-drop" data-plan-drop tabindex="0" role="button" aria-label="생산 엑셀 파일 선택 또는 드롭"><span>생산 엑셀을 놓거나 파일을 선택하세요</span>${button('파일 선택','data-choose-file')}<input type="file" accept=".xlsx" aria-label="생산 엑셀 파일" data-file hidden></div><p data-selected-file>선택한 파일 없음</p>`:''}<div class="business-toolbar production-actions">${isAdmin()?`<button type="button" class="btn primary" data-apply disabled>현황 반영</button>${button('전송 중지','data-cancel-import hidden')}${button('다른 파일 선택','data-new-import')}`:''}${button('새로 조회','data-refresh-production')}${button('엑셀 다운로드','data-export')}</div><p class="production-export-hint">엑셀: 현재 검색·선택 조건의 전체 조회 결과</p>${isAdmin()?`<details class="production-file-guide"><summary>파일 안내 · 양식</summary><p>Sheet1의 .xlsx 파일 · 최대 10MiB. 추가 열·중복 제목·원본과 이전 자료를 보존합니다. 수식은 저장된 계산값을 읽습니다. 상세 검증은 현황 반영 시 수행합니다.</p>${button('예시 포함 양식 다운로드','data-template')}</details>`:''}<div role="status" aria-live="polite" data-import-progress></div><progress data-import-meter max="100" value="0" aria-label="엑셀 처리 진행률" hidden></progress><div data-preview-area></div></details>`;}
export async function wireProductionImports(root,onApplied){
  let engine=null,local=null,file=null,uploadId=null,server=null,columnPage=0,busy=false,cancelled=false,commitSent=false,closed=false;
  const active=()=>root.isConnected&&!closed;
  const progress=(label,percent)=>{if(!active())return;$('[data-import-progress]',root).textContent=label;const meter=$('[data-import-meter]',root);meter.hidden=false;if(percent==null)meter.removeAttribute('value');else meter.value=percent;};
  const check=()=>{if(cancelled||!active())throw Error('전송을 중지했습니다. 이전 현황과 선택 파일을 유지합니다.');};
  const controls=()=>{if(!active())return;for(const selector of ['[data-choose-file]','[data-new-import]','[data-file]','[data-apply]']){const el=$(selector,root);if(el)el.disabled=busy||selector==='[data-apply]'&&(!local||server?.status==='applied');}root.querySelectorAll('[data-map]').forEach(el=>el.disabled=busy||Boolean(server));const cancel=$('[data-cancel-import]',root);if(cancel){cancel.hidden=!busy;cancel.disabled=commitSent;}};
  function render(){
    if(!active())return;const area=$('[data-preview-area]',root),apply=$('[data-apply]',root);if(apply){apply.hidden=false;apply.textContent=server?.status==='applied'?'현황 반영':server?'현황 반영 재시도':'현황 반영';}
    if(!local){area.replaceChildren();return;}
    const {meta,info,sample}=local,columns=meta.columns,start=columnPage*20,shown=columns.slice(start,start+20),duplicates=Object.entries(info.candidates).filter(([,ids])=>ids.length>1);
    const choices=duplicates.map(([field,ids])=>`<label class="business-field"><span>${esc(field)} ${info.required.includes(field)?'* 필수 선택':'선택 · 미선택 시 산정 제외'}</span><select data-map="${esc(field)}"><option value="">사용할 열 선택</option>${ids.map(id=>{const c=columns.find(c=>c.id===id);return `<option value="${id}" ${meta.mapping[field]===id?'selected':''}>${esc(c.title||'제목 없음')} · ${position(c.position)}열</option>`;}).join('')}</select></label>`).join('');
    area.innerHTML=`${choices?'<div class="business-form">'+choices+'</div>':''}<details data-plan-preview><summary>미리보기 · ${meta.rowCount}건 / ${columns.length}열</summary><p>처음 ${sample.length}건 · 열 ${start+1}~${Math.min(start+20,columns.length)}. 원래 열 제목·순서·값을 보존합니다.</p>${table([{label:'원본 행',value:r=>r.number},...shown.map(c=>({label:`${c.title||'(제목 없음)'} [${position(c.position)}]`,value:r=>r.values[columns.indexOf(c)]}))],sample)}<div class="business-toolbar">${start?button('이전 열','data-column-prev'):''}${start+20<columns.length?button('다음 열','data-column-next'):''}</div></details>`;controls();
  }
  function position(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  async function finish(){
    if(!active())return;render();progress(`${server.applyCount}건 반영 완료`,100);$('[data-import-meter]',root).hidden=true;message(root,'');
    try{await onApplied();}catch(e){if(active())message(root,'반영은 완료됐으나 최신 화면 조회에 실패했습니다. 최신 자료 새로 조회를 이용하세요. '+e.message,true);}
  }
  async function choose(chosen){
    if(!chosen)return;if(!/\.xlsx$/i.test(chosen.name)||chosen.size>FILE_LIMIT||chosen.size===0)throw Error('.xlsx 10MiB 이하 파일을 선택하세요.');
    progress('파일 읽기 · 무결성 확인 중…',0);let candidateEngine;
    try{
      const bytes=await chosen.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');check();
      candidateEngine=xlsxClient(p=>progress(p.phase+' 중…',p.percent));const candidate=await candidateEngine.call('parse',{bytes},[bytes]);check();
      engine?.close();engine=candidateEngine;candidateEngine=null;local={...candidate,sha256:sha};file=chosen;uploadId=crypto.randomUUID();server=null;columnPage=0;render();
      $('[data-selected-file]',root).textContent=`${chosen.name} · ${(chosen.size/1024/1024).toFixed(2)}MiB · ${local.meta.rowCount}건`;
      progress('파일 확인 완료 · 미리보기를 확인하고 현황 반영을 누르세요.',100);
    }finally{candidateEngine?.close();}
  }
  async function apply(){
    if(!local||!file)throw Error('생산 엑셀 파일을 선택하세요.');check();
    const validated=await engine.call('validate',{mapping:local.meta.mapping});local.meta=validated.meta;check();
    await api('imports/start',jsonOptions('POST',{id:uploadId,filename:file.name,sha256:local.sha256,size:file.size,meta:local.meta}));check();
    server=await api('imports/'+uploadId);check();if(server.status==='applied')return finish();
    if(!server.meta.sourceReady){progress('원본 파일 전송 중…',null);check();await api('imports/'+uploadId+'/file',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file,timeoutMs:180000});check();}
    if(server.meta.phase!=='ready'){
      let offset=0;while(offset<local.meta.rowCount){check();const part=await engine.call('chunk',{offset});check();const r=await api('imports/'+uploadId+'/chunk',jsonOptions('POST',{rows:part.rows}));check();offset=part.next;progress(`분할 전송 ${r.staged}/${r.total}행 · 이전 현황 유지`,r.staged/r.total*100);await new Promise(resolve=>requestAnimationFrame(resolve));}
      check();await api('imports/'+uploadId+'/ready',{method:'POST'});check();
    }
    server=await api('imports/'+uploadId);check();if(server.status==='applied')return finish();if(!server.canApply)throw Error('전체 자료 검증이 끝나지 않았습니다. 같은 파일로 재시도하세요.');
    commitSent=true;controls();progress('최종 반영 확인 중…',null);await api('imports/'+uploadId+'/apply',{method:'POST'});
    server=await api('imports/'+uploadId);if(server.status!=='applied')throw Error('최종 반영 확인이 필요합니다. 같은 버튼으로 재조회하세요.');await finish();
  }
  async function act(task){
    if(busy||!active())return;busy=true;root.dataset.importBusy='true';cancelled=false;commitSent=false;controls();
    await run(root,null,async()=>{try{await task();}catch(e){
      if(!active())return;
      if(commitSent){try{const current=await api('imports/'+uploadId);if(current.status==='applied'){server=current;await finish();return;}}catch{}}
      // A different PC may have applied the same bytes. Never apply them again.
      if(e.status===409&&local){try{const {record}=await api('imports/latest?kind=production');if(record?.sha256===local.sha256){server={status:'applied',applyCount:record.row_count};await finish();return;}}catch{}}
      progress((cancelled?'전송 중지':'처리 실패: '+e.message)+' · 이전 현황과 선택 파일을 유지합니다. '+(commitSent?'최종 반영 여부를 확인하지 못했습니다. 현황 반영 재시도로 안전하게 확인하세요.':'같은 파일의 현황 반영을 다시 누르면 이어서 처리합니다.'),null);throw e;
    }finally{busy=false;root.dataset.importBusy='false';commitSent=false;render();controls();}});
  }
  root.addEventListener('change',e=>{if(e.target.matches('[data-file]')){const chosen=e.target.files[0];if(chosen)void act(()=>choose(chosen));}const field=e.target.dataset.map;if(field&&local&&!busy&&!server){if(e.target.value)local.meta.mapping[field]=e.target.value;else delete local.meta.mapping[field];}});
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-cancel-import')){if(!commitSent){cancelled=true;progress('중지 요청 · 진행 중인 요청 확인 후 멈춥니다. 이전 현황은 유지합니다.',null);}return;}
    if(b.hasAttribute('data-template')){void run(root,b,()=>download('imports/template?kind=production','생산일정_예시포함.xlsx'));return;}
    if(busy)return;
    if(b.hasAttribute('data-choose-file')||b.hasAttribute('data-new-import')){const input=$('[data-file]',root);input.value='';input.click();return;}
    if(b.hasAttribute('data-column-next')||b.hasAttribute('data-column-prev')){columnPage+=b.hasAttribute('data-column-next')?1:-1;render();$('[data-plan-preview]',root).open=true;}
    if(b.hasAttribute('data-apply'))void act(apply);
  });
  const drop=$('[data-plan-drop]',root);if(drop){
    drop.addEventListener('click',e=>{if(e.target.closest('button,input')||busy)return;const input=$('[data-file]',root);input.value='';input.click();});
    drop.addEventListener('keydown',e=>{if(e.target===drop&&['Enter',' '].includes(e.key)){e.preventDefault();$('[data-choose-file]',root).click();}});
    drop.addEventListener('dragover',e=>{e.preventDefault();if(!busy)drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');if(busy)return;const files=[...e.dataTransfer.files];if(files.length!==1){message(root,'파일은 한 번에 1개씩 선택하세요. 기존 선택은 유지됩니다.',true);return;}void act(()=>choose(files[0]));});
  }
  const guard=e=>{if(active()&&root.classList.contains('active')&&[...e.dataTransfer?.types||[]].includes('Files'))e.preventDefault();};document.addEventListener('dragover',guard);document.addEventListener('drop',guard);
  const clear=()=>{if(!root.isConnected||!window.hpmServerUser){closed=true;cancelled=true;engine?.close();document.removeEventListener('dragover',guard);document.removeEventListener('drop',guard);document.removeEventListener('hpm:auth',clear);}};document.addEventListener('hpm:auth',clear);
}
