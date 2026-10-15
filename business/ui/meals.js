import {$,api,esc,field,table,button,run,message,jsonOptions,shell,today,collection,isAdmin,download} from './common.js';
import {isoWeek,addDays} from '../domain.mjs';
export async function init(root){
  shell(root,'식수인원 관리','한국 시간 ISO 주차 · 기본값은 미신청 · 인원 목록은 관리자가 직접 설정합니다. 식단표는 수동 업로드만 지원합니다.',`<details class="card"><summary>관리 인원 설정</summary><div data-config></div></details><div class="business-toolbar">${field('week','조회 주차 기준일','date',{value:today()})}${field('mealType','식사 구분','select',{values:[['lunch','점심'],['breakfast','아침'],['dinner','저녁']]})}${button('새로 조회','data-refresh')}${button('식수 저장','data-save')}</div><p>수정 후 식수 저장을 눌러야 서버에 반영됩니다. 최대 50명 / 주간 7일을 지원합니다.</p><div data-grid></div><div data-totals></div><details open class="card"><summary>주간 식단표</summary>${isAdmin()?'<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="식단표 이미지" data-menu-file>'+button('식단표 업로드','data-upload-menu'):''}<div data-menus></div></details>`);
  let records=[],people=[],dirty=false,loadedWeek='',menuObjectUrls=[];
  const mealType=()=>$('[name=mealType]',root).value;
  const selectedWeek=()=>isoWeek($('[name=week]',root).value).monday;
  const totals=()=>{
    $('[data-totals]',root).innerHTML=table([{label:'일자',key:'day'},{label:'아침',key:'breakfast'},{label:'점심',key:'lunch'},{label:'저녁',key:'dinner'}],Array.from({length:7},(_,i)=>{const day=addDays(loadedWeek,i),r=records.filter(x=>x.day===day);return {day,...Object.fromEntries(['breakfast','lunch','dinner'].map(k=>[k,r.reduce((s,x)=>s+x[k],0)]))};}));
  };
  const grid=()=>{
    $('[data-grid]',root).innerHTML=`<div class="business-table-wrap"><table class="business-table"><thead><tr><th>인원 / 부서</th>${Array.from({length:7},(_,i)=>`<th>${addDays(loadedWeek,i)}</th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><th>${esc(p.name)} / ${esc(p.department)}${p.active?'':' (비활성)'}</th>${Array.from({length:7},(_,i)=>{const day=addDays(loadedWeek,i),r=records.find(x=>x.person_id===p.id&&x.day===day);return `<td><input type="checkbox" aria-label="${esc(p.name)} ${day} ${esc(mealType())}" data-person="${esc(p.id)}" data-day="${day}" ${r?.[mealType()]?'checked':''}></td>`;}).join('')}</tr>`).join('')||'<tr><td colspan="8">관리 인원을 먼저 설정하세요.</td></tr>'}</tbody></table></div>`;totals();
  };
  const loadMenus=async()=>{
    menuObjectUrls.forEach(u=>URL.revokeObjectURL(u));menuObjectUrls=[];
    const r=await api('menus?week='+loadedWeek);$('[data-menus]',root).innerHTML=r.records.map((r,i)=>`<p>${esc(r.created_at)} ${button('이미지 조회',`data-view-menu="${esc(r.id)}"`)}</p><img data-menu-img="${esc(r.id)}" alt="주간 식단표" class="business-menu-image" hidden>`).join('')||'<p>등록된 식단표 이미지가 없습니다.</p>';
  };
  const load=async()=>{if(dirty&&!confirm('저장하지 않은 식수 변경이 있습니다. 버리고 다시 조회하시겠습니까?'))return;loadedWeek=selectedWeek();records=(await api('meals?week='+loadedWeek)).records;const all=(await api('people')).records;people=all.filter(p=>p.active||records.some(r=>r.person_id===p.id));if(people.length>50)throw new Error('한 주 최대 50명입니다. 관리 인원을 조정하세요.');dirty=false;grid();await loadMenus();};
  root.addEventListener('change',e=>{
    if(e.target.dataset.person){const {person,day}=e.target.dataset;let r=records.find(x=>x.person_id===person&&x.day===day);if(!r){r={person_id:person,day,breakfast:0,lunch:0,dinner:0,revision:0};records.push(r);}r[mealType()]=e.target.checked?1:0;r.dirty=true;dirty=true;root.dataset.dirty='true';totals();}
    if(e.target.name==='mealType')grid();
  });
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.closest('[data-config]'))return;
    if(b.hasAttribute('data-refresh'))void run(root,b,load);
    if(b.hasAttribute('data-save'))void run(root,b,async()=>{const changed=records.filter(r=>r.dirty);if(!changed.length){message(root,'변경된 식수 항목이 없습니다.');return;}await api('meals?week='+loadedWeek,jsonOptions('PUT',{records:changed}));message(root,'D1 서버에서 식수 저장을 확인했습니다.');dirty=false;root.dataset.dirty='false';await load();});
    if(b.hasAttribute('data-upload-menu'))void run(root,b,async()=>{const file=$('[data-menu-file]',root).files[0];if(!file)throw new Error('이미지를 선택하세요.');const form=new FormData();form.set('file',file);await api('menus?week='+loadedWeek,{method:'POST',body:form});message(root,'서버에서 식단표 저장을 확인했습니다.');await loadMenus();});
    if(b.dataset.viewMenu)void run(root,b,async()=>{const response=await window.authorizedFetch('/api/business/menus/'+b.dataset.viewMenu);if(!response.ok)throw new Error('이미지 조회에 실패했습니다.');const url=URL.createObjectURL(await response.blob());menuObjectUrls.push(url);const img=$(`[data-menu-img="${b.dataset.viewMenu}"]`,root);img.src=url;img.hidden=false;});
  });
  await collection($('[data-config]',root),{type:'people',title:'관리 인원',description:'직원 명단은 자동 등록하지 않습니다. 인원별 이름/부서와 사용 여부를 설정하세요.',admin:true,fields:[['name','이름','text',{required:true,max:100}],['department','부서','text',{max:100}],['active','사용 여부','select',{values:[['true','사용'],['false','비활성']]}]],columns:[{label:'이름',key:'name'},{label:'부서',key:'department'},{label:'사용 여부',value:r=>r.active?'사용':'비활성'}]});
  await run(root,null,load);
}
