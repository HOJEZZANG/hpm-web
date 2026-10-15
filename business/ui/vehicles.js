import {$,api,esc,field,table,button,run,message,jsonOptions,shell,uid,today,collection,protectForm,isAdmin} from './common.js';
export async function init(root){
  shell(root,'업무용 차량 관리','한국 날짜·시간 기준 주간 예약 · 차량별 시간 중복은 서버 DB에서 차단합니다. 종료시간과 다음 예약 시작시간이 같으면 허용합니다.',`<details class="card"><summary>차량 목록 설정</summary><div data-config></div></details><div class="business-toolbar">${field('week','조회 주차 기준일','date',{value:today()})}${button('예약 새로 조회','data-refresh')}</div><div data-list></div><form class="business-form card">${field('vehicleId','차량','select',{required:true})}${field('date','이용일','date',{required:true,value:today()})}${field('start','시작시간','time',{required:true,value:'09:00'})}${field('end','종료시간','time',{required:true,value:'18:00'})}${field('applicant','신청자','text',{required:true,max:100})}${field('purpose','용도','textarea',{required:true,max:1000})}${field('remark','비고','textarea',{max:1000})}<div class="wide business-toolbar"><button type="submit" class="btn primary">예약 저장</button>${button('새 예약','data-new')}</div></form>`);
  const form=$('form',root),dirty=protectForm(form);let selected=null,newId=uid(),records=[],cars=[];
  const load=async()=>{
    cars=(await api('vehicles')).records;const value=form.elements.vehicleId.value;form.elements.vehicleId.innerHTML=cars.filter(c=>c.active).map(c=>`<option value="${esc(c.id)}">${esc(c.number)}</option>`).join('');if(cars.some(c=>c.id===value))form.elements.vehicleId.value=value;
    records=(await api('bookings?week='+$('[name=week]',root).value)).records;
    $(':scope > [data-list]',root).innerHTML=table([{label:'차량',value:r=>cars.find(c=>c.id===r.vehicleId)?.number||r.vehicleId},{label:'일자',key:'date'},{label:'시작',key:'start'},{label:'종료',key:'end'},{label:'신청자',key:'applicant'},{label:'용도',key:'purpose'},{label:'비고',key:'remark'},{label:'상태',value:r=>r.cancelled?'취소':'예약'}],records,(r,i)=>r.cancelled?'':button('수정',`data-edit="${i}"`)+button('예약 취소',`data-cancel="${i}"`));
  };
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.closest('[data-config]'))return;
    if(b.hasAttribute('data-refresh'))void run(root,b,load);
    if(b.hasAttribute('data-new')&&dirty.replace()){selected=null;newId=uid();form.reset();dirty.clean();}
    if(b.dataset.edit!==undefined&&dirty.replace()){selected=records[Number(b.dataset.edit)];for(const k of ['vehicleId','date','start','end','applicant','purpose','remark'])form.elements[k].value=selected[k];dirty.clean();form.scrollIntoView({behavior:'smooth'});}
    if(b.dataset.cancel!==undefined&&confirm('이 예약을 취소하시겠습니까?'))void run(root,b,async()=>{const r=records[Number(b.dataset.cancel)];await api('bookings/'+r.id,jsonOptions('DELETE',{revision:r.revision}));message(root,'서버에서 예약 취소를 확인했습니다.');await load();});
  });
  $('[name=week]',root).onchange=()=>void run(root,null,load);
  form.onsubmit=e=>{e.preventDefault();const draft=Object.fromEntries(new FormData(form));void run(root,$('[type=submit]',form),async()=>{await api('bookings/'+(selected?.id||newId),jsonOptions('PUT',{...draft,revision:selected?.revision||0}));message(root,'서버에서 예약 저장을 확인했습니다.');await load();selected=records.find(r=>r.id===(selected?.id||newId))||selected;dirty.clean();});};
  await collection($('[data-config]',root),{type:'vehicles',title:'차량 목록',description:'차량번호를 직접 설정하세요. 사용하지 않는 차량은 비활성으로 바꾸면 기존 예약 이력은 보존됩니다.',admin:true,fields:[['number','차량번호','text',{required:true,max:30}],['description','설명','text',{max:200}],['active','사용 여부','select',{values:[['true','사용'],['false','비활성']]}]],columns:[{label:'차량번호',key:'number'},{label:'설명',key:'description'},{label:'사용 여부',value:r=>r.active?'사용':'비활성'}]});
  await run(root,null,load);
}
