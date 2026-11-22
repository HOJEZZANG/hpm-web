import {BusinessError,ensure} from './domain.mjs';
const SOURCE='https://hiair-cond-v9.kwy1010.workers.dev/api/hpm/production-status';
const fields=['work_order','hull','project','equipment','shell_request_date','cond_completion_date','eva_completion_date','fu','wd','tp','exp','mt','hydro'];
const fail=(message='원본 생산현황을 완전히 조회하지 못했습니다. 잠시 후 다시 조회하세요.',status=502,code='COND_EVA_SOURCE_FAILED')=>{const error=new BusinessError(status,message);error.code=code;throw error;};
async function jsonLimited(response,onSize){
  if(!response.body)fail();const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();fail();}parts.push(value);}}
  finally{reader.releaseLock();}
  onSize(size);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail();}
}
export async function condEva(req,env,user,fetcher=fetch){
  ensure(user?.id&&['user','admin'].includes(user.role),'서버 로그인이 필요합니다.',401);
  ensure(req.method==='GET','조회만 가능합니다.',405);
  ensure(new URL(req.url).pathname==='/api/business/cond-eva'&&!new URL(req.url).search,'지원하지 않는 조회 조건입니다.',400);
  const secret=env.HPM_COND_EVA_READ_TOKEN;
  if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))fail('COND/EVA 조회 연동 설정이 필요합니다.',503,'COND_EVA_SETUP_REQUIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000),items=[],seen=new Set();let after=null,revision,total,updated=null,queriedAt=null,responseBytes=0;
  try{
    for(let page=0;page<40;page++){
      const url=new URL(SOURCE);url.searchParams.set('limit','500');if(after!==null)url.searchParams.set('after',after);
      let response;
      try{response=await fetcher(url.href,{method:'GET',headers:{Authorization:'Bearer '+secret,'Accept':'application/json'},redirect:'manual',signal:controller.signal});}
      catch{fail(controller.signal.aborted?'원본 조회 시간이 초과되었습니다. 다시 조회하세요.':'원본 생산현황에 연결하지 못했습니다.',controller.signal.aborted?504:502);}
      if(response.status!==200){await response.body?.cancel();fail(response.status===401||response.status===403?'원본 조회 연동 인증을 확인해야 합니다.':'원본 생산현황 조회에 실패했습니다.');}
      const data=await jsonLimited(response,size=>{responseBytes+=size;if(responseBytes>16*1024*1024)fail('원본 응답이 조회 크기 한도를 초과했습니다. 전체 조회가 완료되지 않았습니다.',502,'COND_EVA_INCOMPLETE');});
      if(data?.schemaVersion!==1||!Number.isSafeInteger(data.total)||data.total<0||!Array.isArray(data.items)||data.items.length>500||typeof data.hasMore!=='boolean'||typeof data.revision!=='string'||data.revision.length>1000)fail();
      if(data.total>20000)fail('원본이 조회 한도 20,000건을 초과했습니다. 전체 조회가 완료되지 않았습니다.',502,'COND_EVA_INCOMPLETE');
      if(page===0){revision=data.revision;total=data.total;updated=data.sourceUpdatedAt??null;}
      if(data.revision!==revision||data.total!==total||(data.sourceUpdatedAt??null)!==updated)fail('조회 도중 원본 자료가 변경되었습니다. 다시 조회하세요.',409,'COND_EVA_CHANGED');
      if(updated!==null&&(typeof updated!=='string'||!/^\d{4}-\d\d-\d\dT.*Z$/.test(updated)||!Number.isFinite(Date.parse(updated))))fail();
      if(typeof data.queriedAt!=='string'||!Number.isFinite(Date.parse(data.queriedAt)))fail();queriedAt=data.queriedAt;
      for(const source of data.items){
        if(!source||typeof source!=='object'||Array.isArray(source))fail();const row={};
        for(const field of fields){const value=source[field]??null;if(value!==null&&(typeof value!=='string'||value.length>(['work_order','hull'].includes(field)?1000:4000)||value.includes(secret)))fail();row[field]=value;}
        if(!row.work_order||seen.has(row.work_order))fail();seen.add(row.work_order);items.push(row);
      }
      if(!data.hasMore){if(data.nextCursor!==null||items.length!==total)fail('원본 응답의 전체 건수와 실제 조회 건수가 다릅니다. 전체 조회가 완료되지 않았습니다.',502,'COND_EVA_INCOMPLETE');return {items,total,complete:true,fetchedAt:new Date().toISOString(),sourceUpdatedAt:updated,sourceQueriedAt:queriedAt};}
      if(!data.items.length||typeof data.nextCursor!=='string'||data.nextCursor!==data.items.at(-1).work_order||data.nextCursor===after||items.length>=total)fail();after=data.nextCursor;
    }
    fail('원본의 일부만 조회되었습니다. 전체 조회가 완료되지 않았습니다.',502,'COND_EVA_INCOMPLETE');
  }catch(error){if(error instanceof BusinessError)throw error;fail(controller.signal.aborted?'원본 조회 시간이 초과되었습니다. 다시 조회하세요.':undefined,controller.signal.aborted?504:502);}
  finally{clearTimeout(timer);controller.abort();}
}
