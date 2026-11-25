export const weeklyPageSize=50;
export const canManageWeekly=(account,row)=>Boolean(account&&row&&(account.role==='admin'||row.owner===account.id));
export function weeklyPage(rows,page=0){const last=Math.max(0,Math.ceil(rows.length/weeklyPageSize)-1),index=Math.max(0,Math.min(page,last));return {rows:rows.slice(index*weeklyPageSize,(index+1)*weeklyPageSize),page:index,last,total:rows.length};}
// Each existing delete call retains its independent permission/revision check and result.
export async function deleteWeeklyRecords(rows,{canDelete,remove,onResult=()=>{}}){
 const results=[],seen=new Set();
 for(const row of rows){if(seen.has(row.id))continue;seen.add(row.id);let result;
  try{if(!canDelete(row))throw Error('삭제 권한이 없거나 로그인이 변경됐습니다.');const response=await remove(row);if(typeof response?.deleted!=='boolean')throw Error('삭제 결과를 확인하지 못했습니다. 새로 조회해 확인하세요.');result={row,status:response.deleted?'deleted':'absent'};}
  catch(error){result={row,status:'failed',error:error.message||'삭제 확인 실패'};}
  results.push(result);onResult(result,results.length);
 }
 return results;
}
