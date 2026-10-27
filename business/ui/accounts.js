import {$,esc,field,table,button,run,message,jsonOptions,shell,user,isAdmin} from './common.js?v=20261027-access';
const statuses={active:'승인됨',pending:'승인 대기',disabled:'거절 / 이용 중지'};
const time=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미확인';
const roles={admin:'관리자',user:'일반 사용자'};
function actionLabel(action){
  if(action==='account.update')return '계정 사번·승인·권한 변경';
  if(action==='password.change')return '본인 비밀번호 변경';
  const [method,path]=action.split(' '),parts=path?.split('/')||[],kind=parts[2]==='business'?parts[3]:parts[2];
  return ({issues:'문제점',photos:'사진','as-events':'AS 출장','team-events':'팀 일정',calendars:'일정 가져오기',weekly:'주간 이슈',imports:'생산 자료 업로드',notices:'공지사항',vehicles:'차량',people:'식수 인원',meals:'식수',menus:'식단표',bookings:'차량 예약',orders:'소모품 신청'}[kind]||'업무자료')+' '+({PUT:'저장',POST:'등록·반영',DELETE:'삭제'}[method]||'변경');
}
function detailsLabel(details){
  if(!details.before||!details.after)return '처리 완료';
  const b=details.before,a=details.after,changes=[];
  if(b.employeeNo!==a.employeeNo)changes.push(`사번: ${b.employeeNo||'미지정'} → ${a.employeeNo||'미지정'}`);
  if(b.role!==a.role)changes.push(`권한: ${roles[b.role]} → ${roles[a.role]}`);
  if(b.status!==a.status)changes.push(`상태: ${statuses[b.status]} → ${statuses[a.status]}`);
  if(details.productionMemberConfirmed)changes.push('실제 생산관리팀원 확인');
  return changes.join(' / ')||'변경 없음';
}
export async function accounts(root){
  shell(root,'사용자 승인 · 권한 관리','생산관리팀원 여부와 사번을 직접 확인한 계정만 개별적으로 관리자 승인하세요. 소속 입력만으로 권한은 바뀌지 않습니다. 기존 계정은 여기서 사번을 지정하며 다시 가입하지 않습니다.',
    '<div class="business-toolbar">'+button('사용자 새로 조회','data-refresh-users')+'</div><div data-users></div><div data-account-editor></div><details class="card"><summary>계정·관리자 작업 이력</summary><p>작업자와 시각은 서버가 기록합니다. 비밀번호는 표시하거나 기록하지 않습니다.</p>'+button('최근 이력 조회','data-audit')+'<div data-audit-list></div>'+button('이전 이력','data-audit-more hidden')+'</details>');
  if(!isAdmin()){message(root,'관리자 권한이 필요합니다.',true);return;}
  let users=[],selected=null,next=null;
  const load=async()=>{
    ({users}=await window.apiRequest('/api/auth/users'));
    $('[data-users]',root).innerHTML=table([{label:'로그인 ID',key:'loginId'},{label:'사번',value:r=>r.employeeNo||'전환 필요'},{label:'이름',key:'name'},{label:'소속 (본인 입력)',key:'team'},{label:'권한',value:r=>roles[r.role]},{label:'상태',value:r=>statuses[r.status]},{label:'팀원 확인 시각',value:r=>time(r.productionVerifiedAt)}],users,r=>
      button('사번·권한 설정',`data-access="${esc(r.id)}"`)+(r.id!==user().id&&r.role!=='admin'&&r.status!=='active'?button('일반 사용자 승인',`data-user="${esc(r.id)}" data-status="active"`):'')+(r.id!==user().id&&r.status!=='disabled'?button(r.status==='pending'?'거절':'이용 중지',`data-user="${esc(r.id)}" data-status="disabled"`):''));
  };
  function edit(id){
    selected=users.find(r=>r.id===id);if(!selected)return;
    $('[data-account-editor]',root).innerHTML=`<div class="card"><h2>${esc(selected.name)} 계정 설정</h2><p>기존 계정: ${esc(selected.id)} · 작성자·등록 이력과 개인 비밀번호는 유지됩니다. 사번 전환 후에는 새 사번으로 로그인합니다.</p><form class="business-form" data-access-form>${field('employeeNo','확인한 사번','text',{value:selected.employeeNo||'',max:30})}${field('role','권한','select',{values:Object.entries(roles),value:selected.role})}${field('status','승인 상태','select',{values:Object.entries(statuses),value:selected.status})}<label class="wide"><input type="checkbox" name="productionMemberConfirmed"> 실제 생산관리팀원임을 확인했습니다. 관리자 승인 시 전체 업무자료 관리와 사용자 승인 권한을 부여합니다.</label><p class="wide">일반 사용자의 기존 제한은 유지됩니다. 본인 계정의 상태·권한은 다른 관리자에게 요청하세요.</p><div class="wide business-toolbar"><button type="submit" class="btn primary">변경 내용 확인 · 저장</button>${button('닫기','data-close-access')}</div></form></div>`;
    const form=$('[data-access-form]',root);form.elements.role.value=selected.role;form.elements.status.value=selected.status;
    if(selected.id===user().id){form.elements.role.disabled=true;form.elements.status.disabled=true;}
    form.onsubmit=e=>{e.preventDefault();const changes={role:form.elements.role.value,status:form.elements.status.value,productionMemberConfirmed:form.elements.productionMemberConfirmed.checked,authRevision:selected.authRevision,confirmation:selected.id};
      if(form.elements.employeeNo.value.trim())changes.employeeNo=form.elements.employeeNo.value.trim();
      if(changes.role==='admin'&&changes.status==='active'&&(selected.role!=='admin'||selected.status!=='active')&&!changes.productionMemberConfirmed){message(root,'실제 생산관리팀원인지 먼저 확인해 주세요.',true);return;}
      const text=`${selected.name} (${selected.loginId}) 계정을 변경하시겠습니까?\n사번: ${selected.employeeNo||'미지정'} → ${changes.employeeNo||selected.employeeNo||'미지정'}\n권한: ${roles[selected.role]} → ${roles[changes.role]}\n상태: ${statuses[selected.status]} → ${statuses[changes.status]}\n관리자는 전체 업무자료와 사용자 승인을 관리할 수 있습니다.`;
      if(!confirm(text))return;
      void run(root,$('[type=submit]',form),async()=>{await window.apiRequest('/api/auth/users/'+selected.id,jsonOptions('PUT',changes));$('[data-account-editor]',root).replaceChildren();message(root,'서버에서 계정 변경을 확인했습니다. 기존 로그인 세션에도 변경된 권한이 적용됩니다.');await load();await window.refreshPortalIdentity?.();});
    };
    form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function audit(more=false){
    const r=await window.apiRequest('/api/auth/audit'+(more&&next?'?before='+encodeURIComponent(next):''));
    const html=table([{label:'시각 (한국)',value:r=>time(r.at)},{label:'작업자',value:r=>r.actor_name+' ('+r.actor_id+')'},{label:'작업',value:r=>actionLabel(r.action)},{label:'대상',value:r=>r.target_id.startsWith('/api/')?r.target_id.split('/').slice(3).join(' / '):r.target_id},{label:'변경 내용',value:r=>detailsLabel(r.details)}],r.records);
    if(more)$('[data-audit-list]',root).insertAdjacentHTML('beforeend',html);else $('[data-audit-list]',root).innerHTML=html;
    next=r.next;$('[data-audit-more]',root).hidden=!next;
  }
  root.onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-refresh-users'))void run(root,b,load);
    if(b.dataset.access)edit(b.dataset.access);
    if(b.hasAttribute('data-close-access'))$('[data-account-editor]',root).replaceChildren();
    if(b.dataset.user){const target=users.find(r=>r.id===b.dataset.user),status=b.dataset.status;
      if(!target||!confirm(`${target.name} (${target.loginId}) 계정을 ${statuses[status]} 상태로 변경하시겠습니까?${target.role==='admin'?'\n이 관리자의 기존 세션에서도 관리자 접근이 중지됩니다.':''}`))return;
      void run(root,b,async()=>{await window.apiRequest('/api/auth/users/'+target.id,jsonOptions('PUT',{status,authRevision:target.authRevision,confirmation:target.id}));message(root,'서버에서 계정 상태 변경을 확인했습니다.');await load();});
    }
    if(b.hasAttribute('data-audit')||b.hasAttribute('data-audit-more'))void run(root,b,()=>audit(b.hasAttribute('data-audit-more')));
  };
  await run(root,null,load);
}
