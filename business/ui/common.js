export const $=(s,root=document)=>root.querySelector(s);
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export const uid=()=>crypto.randomUUID();
export const user=()=>window.hpmServerUser||null;
export const isAdmin=()=>user()?.role==='admin';
export async function api(path,options={}){return window.apiRequest('/api/business/'+path,options);}
export const jsonOptions=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export function message(root,value,error=false){const node=$('[data-message]',root);if(node){node.textContent=value;node.classList.toggle('error',error);}}
export async function download(path,name){
  const response=await window.authorizedFetch('/api/business/'+path);
  if(!response.ok){let body;try{body=await response.json();}catch{}throw new Error(body?.error||'다운로드에 실패했습니다.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const option=(value,label=value)=>`<option value="${esc(value)}">${esc(label)}</option>`;
export function field(name,label,type='text',options={}){
  const {required=false,values=[],value='',wide=false,max=2000}=options;
  return `<label class="business-field ${wide?'wide':''}"><span>${esc(label)}</span>${type==='textarea'?`<textarea name="${name}" maxlength="${max}" ${required?'required':''}>${esc(value)}</textarea>`:type==='select'?`<select name="${name}" ${required?'required':''}>${values.map(v=>Array.isArray(v)?option(...v):option(v)).join('')}</select>`:`<input name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}>`}</label>`;
}
export function table(columns,records,actions){
  return `<div class="business-table-wrap"><table class="business-table"><thead><tr>${columns.map(c=>`<th scope="col">${esc(c.label||c)}</th>`).join('')}${actions?'<th scope="col">관리</th>':''}</tr></thead><tbody>${records.length?records.map((r,i)=>`<tr>${columns.map(c=>`<td>${esc(typeof c==='string'?r[c]:c.value?c.value(r):r[c.key])}</td>`).join('')}${actions?`<td>${actions(r,i)}</td>`:''}</tr>`).join(''):`<tr><td colspan="${columns.length+(actions?1:0)}">등록된 데이터가 없습니다.</td></tr>`}</tbody></table></div>`;
}
export function protectForm(form){
  let baseline=new FormData(form).toString();
  const snapshot=()=>JSON.stringify([...new FormData(form)]);
  baseline=snapshot();form.dataset.dirty='false';
  form.addEventListener('input',()=>{form.dataset.dirty=String(snapshot()!==baseline);});
  return {clean(){baseline=snapshot();form.dataset.dirty='false';},replace(){return form.dataset.dirty!=='true'||confirm('저장하지 않은 입력이 있습니다. 변경 내용을 버리시겠습니까?');}};
}
export async function run(root,button,task){
  if(button?.disabled)return;const form=button?.closest('form'),controls=form?[...form.querySelectorAll('button')]:button?[button]:[];
  const previous=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);if(form)form.inert=true;root.setAttribute('aria-busy','true');
  try{await task();}catch(e){message(root,e.message,true);}finally{controls.forEach((c,i)=>c.disabled=previous[i]);if(form)form.inert=false;root.setAttribute('aria-busy','false');}
}
export function shell(root,title,description,content){root.innerHTML=`<div class="page-crumb">${esc(title)}</div><div class="module-banner"><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div role="status" aria-live="polite" data-message class="business-message"></div>${content}`;}
export function button(label,attrs=''){return `<button type="button" class="btn outline" ${attrs}>${esc(label)}</button>`;}
export async function collection(root,config){
  const {type,title,description,fields,columns,admin=false,weekly=false,remove=false}=config;
  shell(root,title,description,`<div class="business-toolbar">${weekly?field('week','조회 주차 기준일','date',{value:today()}):''}${button('새로 조회','data-refresh')}${weekly?button('회의용 확대','data-meeting'):''}</div><div data-list></div>${!admin||isAdmin()?`<details class="card" open><summary>등록 · 수정</summary><form class="business-form">${fields.map(f=>field(...f)).join('')}<div class="wide business-toolbar"><button class="btn primary" type="submit">서버에 저장</button>${button('새 기록','data-new')}</div></form></details>`:'<p>설정 변경은 관리자에게 요청하세요.</p>'}`);
  const form=$('form',root),dirty=form&&protectForm(form);let selected=null,records=[],newId=uid();
  const load=async()=>{const res=await api(type+(weekly?'?week='+$('[name=week]',root).value:''));records=res.records;render();};
  function render(){
    $('[data-list]',root).innerHTML=table(columns,records,form?(r,i)=>(isAdmin()||r.owner===user()?.id)?button('수정',`data-edit="${i}"`)+(remove?button('개별 삭제',`data-delete="${i}"`):''):'등록자 또는 관리자에게 요청하세요.':null);
  }
  function reset(){selected=null;newId=uid();form.reset();if(form.elements.date)form.elements.date.value=today();dirty.clean();}
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-refresh'))void run(root,b,load);
    if(b.hasAttribute('data-meeting')){root.classList.toggle('meeting-view');b.textContent=root.classList.contains('meeting-view')?'확대 닫기':'회의용 확대';}
    if(b.hasAttribute('data-new')&&dirty.replace())reset();
    if(b.dataset.edit!==undefined&&dirty.replace()){
      selected=records[Number(b.dataset.edit)];for(const [k,v]of Object.entries(selected)){const el=form.elements[k];if(el)el.type==='checkbox'?el.checked=v:el.value=typeof v==='boolean'?String(v):v;}
      dirty.clean();form.scrollIntoView({block:'center',behavior:'smooth'});
    }
    if(b.dataset.delete!==undefined&&confirm('이 기록 한 건을 삭제하시겠습니까?'))void run(root,b,async()=>{const row=records[Number(b.dataset.delete)];await api(type+'/'+row.id,jsonOptions('DELETE',{revision:row.revision}));message(root,'서버에서 개별 삭제를 확인했습니다.');await load();});
  });
  if(weekly){$('[name=week]',root).addEventListener('change',()=>void run(root,null,load));root.addEventListener('hpm:restore-state',()=>void run(root,null,load));}
  if(form)form.addEventListener('submit',e=>{e.preventDefault();const draft=Object.fromEntries(new FormData(form));if('active'in draft)draft.active=draft.active==='true';void run(root,$('[type=submit]',form),async()=>{const result=await api(type+'/'+(selected?.id||newId),jsonOptions('PUT',{...draft,revision:selected?.revision||0}));selected=result.record;dirty.clean();message(root,'서버 저장을 확인했습니다.');await load();});});
  await run(root,null,load);
}
