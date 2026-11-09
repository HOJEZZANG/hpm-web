import {$,api,esc,field,table,button,run,message,jsonOptions,shell,user,isAdmin,protectForm} from './common.js';
import {openNoticeDetail} from './home-search.js?v=20261106-notices';
export function noticeTime(value){const date=new Date(value);return value&&Number.isFinite(+date)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)+' (한국시간)':'미기록';}
export async function init(root){
 const owner=user()?.id,alive=()=>root.isConnected&&user()?.id===owner;
 shell(root,'공지사항','관리자가 게시한 생산관리 공지사항',`<div class="business-toolbar">${button('새로 조회','data-notice-refresh')}</div><div data-notice-list></div>${isAdmin()?`<details class="card" open><summary>등록 · 수정</summary><form class="business-form notice-form">${field('title','제목','text',{required:true,max:200})}${field('content','내용','textarea',{required:true,max:5000,wide:true})}<div class="wide business-toolbar"><button type="submit" class="btn primary">서버에 저장</button>${button('새 공지','data-notice-new')}</div></form></details>`:''}<dialog class="notice-history" aria-labelledby="noticeHistoryTitle"><div class="notice-history-heading"><h2 id="noticeHistoryTitle">수정 이력</h2>${button('닫기','data-notice-history-close')}</div><p data-notice-history-subject></p><p data-notice-history-status role="status" aria-live="polite"></p><div data-notice-events></div><div class="business-toolbar">${button('이력 새로 조회','data-notice-history-refresh')}${button('이전 이력 50건','data-notice-history-more hidden')}</div></dialog>`);
 const form=$('form',root),dirty=form&&protectForm(form),dialog=$('dialog',root);let records=[],selected=null,newId=crypto.randomUUID(),submission=null,loadSequence=0,historySequence=0,historyTarget=null,nextBefore=null,historyBusy=false;
 function fill(record){selected=record;form.elements.title.value=record.title;form.elements.content.value=record.content;dirty.clean();}
 function reset(){selected=null;newId=crypto.randomUUID();submission=null;form.reset();dirty.clean();}
 async function load(){const sequence=++loadSequence,res=await api('notices');if(!alive()||sequence!==loadSequence)return;records=res.records;
  $('[data-notice-list]',root).innerHTML=table([{label:'제목',key:'title'},{label:'내용',key:'content'},{label:'작성자',value:r=>r.authorName||'미기록'},{label:'수정일',value:r=>noticeTime(r.updatedAt)}],records,(r,i)=>(form?button('수정',`data-notice-edit="${i}"`):'')+button('수정 이력',`data-notice-history="${i}"`));
 }
 function closeHistory(){historySequence++;historyBusy=false;dialog.close();}
 async function loadHistory(resetPage=false){
  if(historyBusy||!historyTarget)return;historyBusy=true;const sequence=++historySequence,id=historyTarget.id;
  if(resetPage){nextBefore=null;$('[data-notice-events]',dialog).replaceChildren();}
  dialog.setAttribute('aria-busy','true');$('[data-notice-history-status]',dialog).textContent='수정 이력 조회 중…';
  for(const b of dialog.querySelectorAll('[data-notice-history-refresh],[data-notice-history-more]'))b.disabled=true;
  try{const response=await api('notices/'+encodeURIComponent(id)+'/history'+(nextBefore?'?before='+nextBefore:''));if(!alive()||sequence!==historySequence||!dialog.open)return;
   $('[data-notice-events]',dialog).insertAdjacentHTML('beforeend',response.records.map(entry=>`<details class="notice-event"><summary><strong>${esc(entry.editorName)}</strong><time>${esc(noticeTime(entry.at))}</time><span>${esc(entry.changes.map(c=>c.label).join(' · '))}</span></summary>${entry.changes.map(change=>`<section><h3>${esc(change.label)}</h3><div class="notice-change"><div><h4>변경 전</h4><pre>${esc(change.before)}</pre></div><div><h4>변경 후</h4><pre>${esc(change.after)}</pre></div></div></section>`).join('')}</details>`).join(''));
   nextBefore=response.nextBefore;$('[data-notice-history-more]',dialog).hidden=!nextBefore;$('[data-notice-history-status]',dialog).textContent=$('[data-notice-events]',dialog).children.length?'최신 수정부터 표시합니다.':'수정 이력이 없습니다';
  }catch(error){if(alive()&&sequence===historySequence)$('[data-notice-history-status]',dialog).textContent=error.message;}
  finally{if(sequence===historySequence){historyBusy=false;dialog.setAttribute('aria-busy','false');for(const b of dialog.querySelectorAll('[data-notice-history-refresh],[data-notice-history-more]'))b.disabled=false;}}
 }
 root.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-notice-refresh'))void run(root,b,load);
  if(b.hasAttribute('data-notice-new')&&form&&dirty.replace())reset();
  if(b.dataset.noticeEdit!==undefined&&form&&dirty.replace()){submission=null;fill(records[Number(b.dataset.noticeEdit)]);form.scrollIntoView({block:'center',behavior:'smooth'});}
  if(b.dataset.noticeHistory!==undefined){historySequence++;historyBusy=false;historyTarget=records[Number(b.dataset.noticeHistory)];$('[data-notice-history-subject]',dialog).textContent=historyTarget.title;dialog.showModal();void loadHistory(true);}
  if(b.hasAttribute('data-notice-history-close'))closeHistory();
  if(b.hasAttribute('data-notice-history-refresh'))void loadHistory(true);
  if(b.hasAttribute('data-notice-history-more'))void loadHistory();
 });
 dialog.addEventListener('cancel',event=>{event.preventDefault();closeHistory();});
 if(form)form.addEventListener('submit',event=>{event.preventDefault();const draft=Object.fromEntries(new FormData(form)),id=selected?.id||newId,revision=selected?.revision||0,signature=JSON.stringify({id,revision,...draft});
  if(submission?.signature!==signature)submission={signature,mutationId:crypto.randomUUID()};const mutationId=submission.mutationId;
  void run(root,$('[type=submit]',form),async()=>{const result=await api('notices/'+encodeURIComponent(id),jsonOptions('PUT',{...draft,revision,mutationId}));if(!alive())return;fill(result.record);submission=null;message(root,result.unchanged?'변경된 제목·내용이 없습니다.':result.replayed?'이전 저장을 확인했습니다. 최신 공지를 표시합니다.':'서버 저장을 확인했습니다.');await load();});
 });
 const dispose=()=>{if(!alive()){loadSequence++;historySequence++;if(dialog.open)dialog.close();document.removeEventListener('hpm:auth',dispose);}};document.addEventListener('hpm:auth',dispose);
 root.hpmOpenRecord=record=>openNoticeDetail(root,record);await run(root,null,load);
}
