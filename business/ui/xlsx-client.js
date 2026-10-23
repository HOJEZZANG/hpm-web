export function xlsxClient(onProgress=()=>{}){
  const worker=new Worker(new URL('../../assets/xlsx-worker.js?v=20261022',import.meta.url)),pending=new Map();let next=0;
  worker.onmessage=({data})=>{if(data.progress){onProgress(data.progress);return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};
  worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('엑셀 작업 스레드를 시작하지 못했습니다. 새로고침 후 다시 시도하세요.'));pending.clear();};
  return {call(type,data={},transfer=[]){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({id,type,...data},transfer);});},close(){worker.terminate();for(const p of pending.values())p.reject(new Error('엑셀 작업을 종료했습니다.'));pending.clear();}};
}
