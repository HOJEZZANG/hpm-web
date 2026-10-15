import {$,api,esc,field,table,button,run,message,jsonOptions,download,isAdmin} from './common.js';
export function importPanel(kind){return `<details class="card"><summary>엑셀 업로드 · 양식 · 이력</summary><p>양식은 예시 1행을 포함합니다. 실제 데이터로 바꾸세요. .xlsx 2MB / 500행 / 40열까지 지원합니다. 원본·이력은 보존되며 업로드별로 조회합니다. 기존 자료는 자동 병합·덮어쓰기하지 않습니다.</p><div class="business-toolbar">${button('예시 포함 양식 다운로드','data-template')}${isAdmin()?'<input aria-label="엑셀 파일" type="file" accept=".xlsx" data-file><button type="button" class="btn primary" data-preview>검증 · 미리보기</button>':'<span>업로드·반영은 관리자 권한이 필요합니다.</span>'}</div><div data-preview-area></div><div data-import-history></div></details><div class="business-toolbar">${field('batch','조회할 반영 이력','select',{values:[['','이력을 선택하세요']]})}${button('이력 새로 조회','data-reload-imports')}</div>`;}
export async function wireImports(root,kind,onSelect){
  let previewId=null;
  const refresh=async()=>{
    const {records}=await api('imports?kind='+kind),select=$('[name=batch]',root),previous=select.value;
    select.innerHTML='<option value="">이력을 선택하세요</option>'+records.filter(r=>r.status==='applied').map(r=>`<option value="${esc(r.id)}">${esc(r.created_at.slice(0,16))} · ${esc(r.filename)} · ${r.row_count}행</option>`).join('');select.value=previous;
    $('[data-import-history]',root).innerHTML=table([{label:'파일',key:'filename'},{label:'등록시각',key:'created_at'},{label:'행 수',key:'row_count'},{label:'상태',key:'status'}],records,r=>button('원본 다운로드',`data-original="${esc(r.id)}"`)+(r.status==='preview'&&isAdmin()?button('미리보기 재열기',`data-open-preview="${esc(r.id)}"`):''));
  };
  function preview(r){
    previewId=r.id;$('[data-preview-area]',root).innerHTML=`<p>검증된 반영 예정: ${r.applyCount}행 · 기존 데이터 변경: 0행</p><p>${(r.warnings||[]).slice(0,10).map(esc).join('<br>')}</p>${table(r.headers,r.rows.slice(0,30).map(x=>x.data))}<p>미리보기 최대 30행 / 전체 ${r.applyCount}행. 반영 후에도 업로드 원본을 내려받을 수 있습니다.</p>${r.status!=='applied'?button(`${r.applyCount}행 신규 반영`,'data-apply'):''}`;
  }
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-template'))void run(root,b,()=>download('imports/template?kind='+kind,kind+'_업로드양식_예시포함.xlsx'));
    if(b.hasAttribute('data-reload-imports'))void run(root,b,refresh);
    if(b.dataset.original)void run(root,b,()=>download('imports/'+b.dataset.original+'/file','업로드원본.xlsx'));
    if(b.dataset.openPreview)void run(root,b,async()=>preview(await api('imports/'+b.dataset.openPreview)));
    if(b.hasAttribute('data-preview'))void run(root,b,async()=>{const file=$('[data-file]',root).files[0];if(!file)throw new Error('엑셀 파일을 선택하세요.');if(file.size>2*1024*1024)throw new Error('2MB 이하 파일을 선택하세요.');const form=new FormData();form.set('kind',kind);form.set('file',file);preview(await api('imports',{method:'POST',body:form}));message(root,'검증이 끝났습니다. 반영 행 수를 확인하세요.');await refresh();});
    if(b.hasAttribute('data-apply'))void run(root,b,async()=>{const result=await api('imports/'+previewId+'/apply',{method:'POST'});message(root,`서버에서 ${result.applied}행 반영을 확인했습니다.`);$('[data-preview-area]',root).textContent='반영 완료';await refresh();$('[name=batch]',root).value=previewId;await onSelect(previewId);});
  });
  $('[name=batch]',root).onchange=()=>void run(root,null,()=>onSelect($('[name=batch]',root).value));
  await run(root,null,refresh);return refresh;
}
