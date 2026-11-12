import {ensure,validateRecord,date,koreanToday} from './domain.mjs';
import {bodyJson} from './http.mjs';
import {admin,idOk,now} from './access.mjs';

const fields=['title','content'];
const labels={title:'제목',content:'내용',noticeDate:'작성일'};
const actionFor=id=>'PUT /api/business/notices/'+id;
const name=value=>typeof value==='string'?value.trim():'';
const stored=row=>JSON.parse(row.data);
function noticeDay(row){
  if(row.day)return row.day;
  if(!row.created_at)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(row.created_at||''))return row.created_at;
  const stamp=new Date(row.created_at);
  return Number.isFinite(+stamp)?koreanToday(stamp):'';
}
function author(row,data=stored(row)){
  const saved=data.noticeMeta?.version===1&&data.noticeMeta.author;
  // owner is the existing immutable creator ID; never replace it with the editor.
  return saved&&saved.id===row.owner?{id:row.owner,name:name(saved.name)}:{id:row.owner,name:name(row.owner_name)};
}
function view(row){
  const data=stored(row);
  return {id:row.id,revision:row.revision,title:data.title??'',content:data.content??'',noticeDate:noticeDay(row),createdAt:row.created_at,updatedAt:row.updated_at,
    authorName:author(row,data).name||'미기록',lastEditorName:name(data.noticeMeta?.lastEditor?.name)||null};
}
const select='SELECT n.*,a.name AS owner_name FROM notices n LEFT JOIN portal_accounts a ON a.id=n.owner';
const find=(env,id)=>env.DB.prepare(select+' WHERE n.id=?').bind(id).first();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function receipt(env,id,user,mutationId,method='PUT'){
  return env.DB.prepare("SELECT details FROM portal_audit WHERE action=? AND target_id=? AND actor_id=? AND json_extract(details,'$.noticeMutationId')=? AND json_extract(details,'$.noticeKind') IN ('created','updated','deleted') ORDER BY id DESC LIMIT 1")
    .bind(method+' /api/business/notices/'+id,'/api/business/notices/'+id,user.id,mutationId).first();
}
async function replay(env,id,user,mutationId,payloadHash){
  const saved=await receipt(env,id,user,mutationId);if(!saved)return null;
  ensure(JSON.parse(saved.details).payloadHash===payloadHash,'같은 저장 요청 ID에 다른 내용이 있습니다. 새로 조회해 비교하세요.',409);
  const row=await find(env,id);ensure(row,'공지사항을 찾을 수 없습니다.',404);
  return {record:view(row),replayed:true};
}
async function history(env,id,url){
  ensure(await find(env,id),'공지사항을 찾을 수 없습니다.',404);
  const before=url.searchParams.has('before')?Number(url.searchParams.get('before')):Number.MAX_SAFE_INTEGER;
  ensure(Number.isSafeInteger(before)&&before>0,'이력 조회 위치를 확인하세요.');
  const {results}=await env.DB.prepare("SELECT id,actor_name,at,details FROM portal_audit WHERE action=? AND target_id=? AND json_extract(details,'$.noticeKind')='updated' AND id<? ORDER BY id DESC LIMIT 51")
    .bind(actionFor(id),'/api/business/notices/'+id,before).all();
  const page=results.slice(0,50);
  return {records:page.map(row=>{const data=JSON.parse(row.details);return {id:String(row.id),editorName:name(row.actor_name)||'미기록',at:row.at,revision:data.toRevision,
    changes:(data.changes||[]).filter(c=>Object.hasOwn(labels,c.field)).map(c=>({field:c.field,label:labels[c.field],before:c.before,after:c.after}))};}),nextBefore:results.length>50?page.at(-1).id:null};
}
async function removeNotice(req,env,user,id){
  const body=await bodyJson(req),revision=body.revision;
  ensure(Number.isSafeInteger(revision)&&revision>0,'삭제할 공지 버전을 확인하세요.');
  if(body.mutationId!==undefined)ensure(typeof body.mutationId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(body.mutationId),'삭제 요청 ID를 확인하세요.');
  const mutationId=body.mutationId||'delete-revision-'+revision,payloadHash=await digest(JSON.stringify({revision}));
  async function replayDeletion(){
    const saved=await receipt(env,id,user,mutationId,'DELETE');
    if(!saved)return false;
    ensure(JSON.parse(saved.details).payloadHash===payloadHash,'같은 삭제 요청 ID에 다른 버전이 있습니다. 새로 조회하세요.',409);
    return true;
  }
  if(await replayDeletion())return {id,deleted:true,replayed:true};
  const previous=await find(env,id);
  ensure(previous,'공지사항을 찾을 수 없습니다.',404);
  ensure(previous.revision===revision,'다른 PC에서 수정했습니다. 새로 조회한 뒤 삭제하세요.',409);
  const stamp=now(),details={noticeKind:'deleted',noticeMutationId:mutationId,payloadHash,fromRevision:revision,
    deletedRecord:{owner:previous.owner,data:stored(previous),day:previous.day,createdAt:previous.created_at,updatedAt:previous.updated_at}};
  const result=await env.DB.batch([
    env.DB.prepare('DELETE FROM notices WHERE id=? AND revision=?').bind(id,revision),
    env.DB.prepare('INSERT INTO portal_audit(actor_id,actor_name,action,target_id,details,at) SELECT ?,?,?,?,?,? WHERE changes()=1')
      .bind(user.id,user.name,'DELETE /api/business/notices/'+id,'/api/business/notices/'+id,JSON.stringify(details),stamp)
  ]);
  if(result[0].meta.changes!==1){
    if(await replayDeletion())return {id,deleted:true,replayed:true};
    ensure(false,'다른 PC에서 변경했습니다. 새로 조회한 뒤 삭제하세요.',409);
  }
  return {id,deleted:true};
}
export async function notices(req,env,user,id,action,url){
  const parts=url.pathname.replace(/^\/api\/business\/?/,'').split('/');
  ensure(parts.length<=3,'요청한 공지 API가 없습니다.',404);
  if(!id){
    ensure(req.method==='GET'&&!action,'조회만 가능합니다.',405);
    const {results}=await env.DB.prepare(select+' ORDER BY n.updated_at DESC,n.id LIMIT 2001').all();
    ensure(results.length<=2000,'조회 범위가 큽니다. 관리자에게 문의하세요.',413);return {records:results.map(view)};
  }
  ensure(idOk(id),'공지 ID를 확인하세요.');
  if(action){ensure(action==='history','요청한 공지 API가 없습니다.',404);ensure(req.method==='GET','수정 이력은 조회만 가능합니다.',405);return history(env,id,url);}
  ensure(['PUT','DELETE'].includes(req.method),'지원하지 않는 요청입니다.',405);admin(user);
  if(req.method==='DELETE')return removeNotice(req,env,user,id);
  const body=await bodyJson(req),validated=validateRecord('notices',body),revision=body.revision??0;
  ensure(Number.isSafeInteger(revision)&&revision>=0,'공지 수정 버전을 확인하세요.');
  if(body.mutationId!==undefined)ensure(typeof body.mutationId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(body.mutationId),'저장 요청 ID를 확인하세요.');
  const payloadHash=await digest(JSON.stringify({revision,title:body.title,content:body.content,...(Object.hasOwn(body,'noticeDate')?{noticeDate:body.noticeDate}:{})}));
  // Revision + payload is also stable for older clients that send no mutation ID.
  const mutationId=body.mutationId||'revision-'+revision+'-'+payloadHash;
  const repeated=await replay(env,id,user,mutationId,payloadHash);if(repeated)return repeated;
  const previous=await find(env,id),old=previous?stored(previous):{};
  ensure(previous?revision===previous.revision:revision===0,'다른 PC에서 수정했습니다. 입력을 보관한 뒤 새로 조회해 비교하세요.',409);
  const day=Object.hasOwn(body,'noticeDate')?date(body.noticeDate,'작성일'):previous?previous.day:koreanToday();
  const next={...old,...validated};
  // Preserve exact legacy text on an unchanged field, including its whitespace.
  if(previous)for(const field of fields)if(body[field]===old[field])next[field]=old[field];
  const changes=previous?fields.filter(field=>next[field]!==old[field]).map(field=>({field,before:old[field]??'',after:next[field]})):[];
  if(previous&&Object.hasOwn(body,'noticeDate')&&day!==noticeDay(previous))changes.push({field:'noticeDate',before:noticeDay(previous),after:day});
  if(previous&&!changes.length)return {record:view(previous),unchanged:true};
  const stamp=now(),creator=previous?author(previous,old):{id:user.id,name:user.name};
  next.noticeMeta={version:1,author:creator,...(previous?{lastEditor:{id:user.id,name:user.name,at:stamp}}:{})};
  const toRevision=previous?revision+1:1,details={noticeKind:previous?'updated':'created',noticeMutationId:mutationId,payloadHash,fromRevision:revision,toRevision,changes};
  const save=previous?env.DB.prepare('UPDATE notices SET data=?,day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(next),day,stamp,id,revision)
    :env.DB.prepare('INSERT INTO notices(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,user.id,JSON.stringify(next),day,stamp,stamp);
  // D1 batch is transactional. An audit failure rolls back the notice as well.
  const result=await env.DB.batch([save,env.DB.prepare('INSERT INTO portal_audit(actor_id,actor_name,action,target_id,details,at) SELECT ?,?,?,?,?,? WHERE changes()=1')
    .bind(user.id,user.name,actionFor(id),'/api/business/notices/'+id,JSON.stringify(details),stamp)]);
  if(result[0].meta.changes!==1){const repeated=await replay(env,id,user,mutationId,payloadHash);if(repeated)return repeated;ensure(false,'다른 PC에서 수정했습니다. 입력을 보관한 뒤 새로 조회해 비교하세요.',409);}
  return {record:view(await find(env,id))};
}
