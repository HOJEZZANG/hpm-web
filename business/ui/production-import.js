import {$,api,esc,table,button,run,message,download,isAdmin,jsonOptions} from './common.js';
import {xlsxClient} from './xlsx-client.js';
const FILE_LIMIT=10*1024*1024;
export function productionImportPanel(){return `<details class="card" data-import-panel><summary>생산 엑셀 · 미리보기 · 업로드 이력</summary><p>.xlsx 최대 10MiB. Sheet1을 사용합니다. 500행·40열 제한 없이 추가 열과 중복/빈 제목을 열 위치로 구분합니다. 완전히 빈 열·서식만 있는 범위는 제외합니다.</p><p class="hint">처리 예산: 압축 해제 32MiB, 유효 셀 250,000개, 텍스트 16MiB, 해석 데이터 32MiB, 행당 128KiB. 무제한 처리는 지원하지 않습니다. 수식은 실행하지 않고 저장된 계산값만 사용합니다.</p><p>원본과 이력은 서버에 보존합니다. 미리보기·분할 전송 중에는 기존 계획을 변경하지 않으며 최종 반영을 완료한 이력만 조회합니다.</p><div class="business-toolbar">${button('예시 포함 양식 다운로드','data-template')}${isAdmin()?'<input type="file" accept=".xlsx" aria-label="생산 엑셀 파일" data-file><button type="button" class="btn primary" data-preview>파일 읽기 · 미리보기</button>'+button('다른 파일로 새 미리보기','data-new-import'):'<span>업로드·반영은 관리자 권한이 필요합니다.</span>'}</div><div role="status" aria-live="polite" data-import-progress></div><progress data-import-meter max="100" value="0" aria-label="엑셀 처리 진행률" hidden></progress><div data-preview-area></div><div data-import-history></div></details><div class="business-toolbar"><label>조회할 반영 이력 <select name="batch"><option value="">이력을 선택하세요</option></select></label>${button('이력 새로 조회','data-reload-imports')}</div>`;}
export async function wireProductionImports(root,onSelect){
  let engine=null,local=null,file=null,uploadId=null,resume=null,server=null,columnPage=0,busy=false,acknowledged=0;
  const progress=(label,percent)=>{if(!root.isConnected)return;$('[data-import-progress]',root).textContent=label;const meter=$('[data-import-meter]',root);meter.hidden=false;if(percent==null)meter.removeAttribute('value');else meter.value=percent;};
  function client(){return engine||(engine=xlsxClient(p=>progress(p.phase+' 중…',p.percent)));}
  const labels={source:'원본 전송 대기',staging:'분할 전송 중',ready:'검증 미리보기 준비됨'};
  const refresh=async()=>{
    const r=await api('imports?kind=production'),select=$('[name=batch]',root),previous=select.value;
    select.innerHTML='<option value="">이력을 선택하세요</option>'+r.records.filter(r=>r.status==='applied').map(r=>`<option value="${esc(r.id)}">${esc(r.filename)} · ${r.row_count}행</option>`).join('');select.value=previous;
    $('[data-import-history]',root).innerHTML=table([{label:'파일',key:'filename'},{label:'등록 시각',key:'created_at'},{label:'행 수',key:'row_count'},{label:'상태',value:r=>r.status==='applied'?'반영 완료':labels[r.phase]||'미리보기'}],r.records,r=>button('원본 다운로드',`data-original="${esc(r.id)}"`)+(isAdmin()&&r.status!=='applied'?button('진행/미리보기',`data-open-preview="${esc(r.id)}"`):''));
  };
  function render(){
    const area=$('[data-preview-area]',root);if(!local&&!server){area.replaceChildren();return;}
    const meta=local?.meta||server.meta,columns=meta.columns,start=columnPage*20,shown=columns.slice(start,start+20),rows=local?.sample||server.rows.map(r=>({number:r.number,values:r.data.__cells}));
    const info=local?.info,mapping=meta.mapping;
    const choices=info?Object.entries(info.candidates).filter(([,ids])=>ids.length>1).map(([field,ids])=>`<label class="business-field"><span>${esc(field)} ${info.required.includes(field)?' * (필수 선택)':'(선택)'}</span><select data-map="${esc(field)}" ${resume||server||busy?'disabled':''}><option value="">사용할 열을 선택하세요</option>${ids.map(id=>{const c=columns.find(c=>c.id===id);return `<option value="${id}" ${mapping[field]===id?'selected':''}>${esc(c.title||'제목 없음')} · ${position(c.position)}열 · ${id}</option>`;}).join('')}</select></label>`).join(''):'';
    area.innerHTML=`<h3>열 위치별 미리보기</h3><p>전체 ${meta.rowCount}행 / ${columns.length}개 사용 열 · 처음 ${rows.length}행 · 열 ${start+1}~${Math.min(start+20,columns.length)}. 원본의 열 제목·순서·값은 보존합니다.</p>${choices?'<div class="business-form">'+choices+'</div>':''}${table([{label:'원본 행',value:r=>r.number},...shown.map(c=>({label:`${c.title||'(제목 없음)'} [${position(c.position)} · ${c.id}]`,value:r=>r.values[columns.indexOf(c)]}))],rows)}<div class="business-toolbar">${start?button('이전 열','data-column-prev'):''}${start+20<columns.length?button('다음 열','data-column-next'):''}</div>${server?`<p>서버 보존 ${server.staged}/${meta.rowCount}행 · 업무 반영 ${server.status==='applied'?meta.rowCount:0}행. ${server.canApply?'검증이 끝났습니다. 아래 반영을 선택하세요.':server.status==='applied'?'반영 완료':'미완료 전송은 동일 파일을 다시 선택해 이어갈 수 있습니다.'}</p>`:''}${local&&server?.status!=='applied'?button('원본 보존 · 서버 미리보기 준비 / 재시도','data-prepare'):''}${server?.canApply?button(`${meta.rowCount}행 신규 반영`,'data-apply'):''}`;
  }
  root.addEventListener('change',e=>{const field=e.target.dataset.map;if(field&&local&&!busy){if(e.target.value)local.meta.mapping[field]=e.target.value;else delete local.meta.mapping[field];}});
  function position(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  async function parse(){
    const chosen=$('[data-file]',root).files[0];if(!chosen)throw Error('엑셀 파일을 선택하세요.');if(!/\.xlsx$/i.test(chosen.name)||chosen.size>FILE_LIMIT)throw Error('.xlsx 10MiB 이하 파일을 선택하세요.');
    progress('파일 읽기 및 무결성 확인 중…',0);const bytes=await chosen.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(resume&&resume.sha256!==sha)throw Error('이어갈 이력과 같은 원본 파일을 선택하세요. 다른 파일은 새 미리보기로 시작하세요.');
    engine?.close();engine=null;local=await client().call('parse',{bytes},[bytes]);file=chosen;local.sha256=sha;uploadId=resume?.id||crypto.randomUUID();if(resume)local.meta.mapping={...resume.meta.mapping};columnPage=0;server=resume;acknowledged=resume?.staged||0;render();progress('브라우저 미리보기 완료 · 중복 필수 열을 확인하세요.',100);
  }
  async function prepare(){
    if(!local||!file)throw Error('파일을 읽고 미리보기를 확인하세요.');const validated=await client().call('validate',{mapping:local.meta.mapping});local.meta=validated.meta;
    await api('imports/start',jsonOptions('POST',{id:uploadId,filename:file.name,sha256:local.sha256,size:file.size,meta:local.meta}));server=await api('imports/'+uploadId);acknowledged=server.staged;
    if(server.status==='applied'){progress('이미 반영 완료된 업로드입니다.',100);render();await refresh();return;}
    if(!server.meta.sourceReady){progress('원본 파일 전송 중…',null);await api('imports/'+uploadId+'/file',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file,timeoutMs:180000});}
    if(server.meta.phase!=='ready'){
      let offset=0;while(offset<local.meta.rowCount){const part=await client().call('chunk',{offset});const r=await api('imports/'+uploadId+'/chunk',jsonOptions('POST',{rows:part.rows}));acknowledged=r.staged;offset=part.next;progress(`서버 분할 보존 ${r.staged}/${r.total}행 · 기존 계획 변경 0행`,r.staged/r.total*100);await new Promise(resolve=>requestAnimationFrame(resolve));}
      await api('imports/'+uploadId+'/ready',{method:'POST'});
    }
    server=await api('imports/'+uploadId);render();await refresh();progress(`서버 검증 완료 · ${server.staged}행 · PND 빈 값 ${validated.warnings}행. 최종 반영 전입니다.`,100);
  }
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-column-next')){columnPage++;render();return;}if(b.hasAttribute('data-column-prev')){columnPage--;render();return;}
    const task=async()=>{
      if(b.hasAttribute('data-template'))return download('imports/template?kind=production','생산일정_예시포함.xlsx');
      if(b.hasAttribute('data-reload-imports'))return refresh();
      if(b.dataset.original)return download('imports/'+b.dataset.original+'/file','업로드원본.xlsx');
      if(b.hasAttribute('data-new-import')){engine?.close();engine=null;local=server=resume=null;uploadId=null;acknowledged=0;render();progress('새 파일을 선택하세요.',0);return;}
      if(b.dataset.openPreview){server=await api('imports/'+b.dataset.openPreview);if(server.version!==2){$('[data-preview-area]',root).textContent='이전 형식의 이력입니다. 원본 다운로드와 기존 반영 조회를 이용하세요.';return;}local=null;resume=server;acknowledged=server.staged;uploadId=server.id;render();progress(server.canApply?'미리보기 준비됨':'같은 원본 파일을 선택하고 파일 읽기 → 서버 준비로 이어갈 수 있습니다.',null);return;}
      if(b.hasAttribute('data-preview'))return parse();
      if(b.hasAttribute('data-prepare'))return prepare();
      if(b.hasAttribute('data-apply')){const r=await api('imports/'+server.id+'/apply',{method:'POST'});message(root,`서버에서 ${r.applied}행 반영을 확인했습니다.`);$('[data-preview-area]',root).textContent='반영 완료';progress('반영 완료',100);await refresh();$('[name=batch]',root).value=server.id;await onSelect(server.id);return;}
    };
    if(!['data-template','data-reload-imports','data-new-import','data-open-preview','data-preview','data-prepare','data-apply','data-original'].some(k=>b.hasAttribute(k)))return;if(busy)return;busy=true;root.querySelectorAll('[data-map]').forEach(el=>el.disabled=true);
    void run(root,b,async()=>{try{await task();}catch(error){const count=local?.meta.rowCount||server?.meta?.rowCount||0;progress('처리 실패: '+error.message+` · 서버 응답으로 확인된 분할 보존 ${acknowledged}/${count}행. `+(b.hasAttribute('data-apply')?'최종 반영 여부는 이력 새로 조회로 확인하세요.':'이번 단계는 최종 업무 반영 전입니다. 실패 요청의 저장 여부는 재조회로 확인하세요.')+' 입력/파일은 유지됩니다. 같은 작업으로 재시도하면 중복 저장하지 않습니다.',null);throw error;}finally{busy=false;root.querySelectorAll('[data-map]').forEach(el=>el.disabled=Boolean(resume||server));}});
  });
  $('[name=batch]',root).onchange=()=>void run(root,null,()=>onSelect($('[name=batch]',root).value));
  const clear=()=>{if(!root.isConnected||!window.hpmServerUser){engine?.close();engine=null;if(!root.isConnected)document.removeEventListener('hpm:auth',clear);}};document.addEventListener('hpm:auth',clear);
  await run(root,null,refresh);return refresh;
}
