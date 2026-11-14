// Only session credentials stay in this browser tab. All shared records live on the server.
const API=['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'https://hpmanagement-web.lotusland1995.workers.dev';
window.hpmServerUser=null;
window.authorizedFetch=(path,options={})=>{
  const url=path.startsWith('/')?API+path:path,headers=new Headers(options.headers);
  if(url.startsWith(API+'/api/')){const token=sessionStorage.getItem('hpmServerToken');if(token)headers.set('Authorization','Bearer '+token);}
  return fetch(url,{...options,headers});
};
const blobs=new Map(),reverse=new Map(),pending=new Map(),watched=new WeakMap();let photoEpoch=0;
window.hpmCanonicalPhoto=value=>reverse.get(value)||value;
function photoState(img,state){
  const frame=img.closest('[data-photo-state]');if(!frame)return;
  frame.dataset.photoState=state;frame.setAttribute('aria-busy',String(state==='loading'));
  const status=frame.querySelector('.photo-load-status');if(status)status.textContent=state==='waiting'?'사진 대기 중':state==='loading'?'사진 불러오는 중…':state==='error'?'사진 불러오기 실패 · 다시 열어 주세요.':'';
}
async function loadPhoto(img){
  const source=img.dataset.photoSrc,epoch=photoEpoch;
  if(!source||!window.hpmServerUser||!img.isConnected)return;
  const current=()=>epoch===photoEpoch&&Boolean(window.hpmServerUser)&&img.isConnected&&img.dataset.photoSrc===source;
  photoState(img,'loading');
  if(!source.startsWith(API+'/api/photos/')){
    img.onload=()=>{if(current())photoState(img,'loaded');};img.onerror=()=>{if(current())photoState(img,'error');};img.src=source;return;
  }
  try{
    if(!blobs.has(source)){
      if(!pending.has(source)){
        const controller=new AbortController(),entry={controller,promise:null};
        entry.promise=(async()=>{const timer=setTimeout(()=>controller.abort(),30000);
          try{const r=await window.authorizedFetch(source,{signal:controller.signal});if(!r.ok)throw new Error('사진을 읽을 수 없습니다.');const blob=await r.blob();
            if(epoch!==photoEpoch||!window.hpmServerUser)throw new Error('로그인 정보가 변경되었습니다.');
            const url=URL.createObjectURL(blob);blobs.set(source,url);reverse.set(url,source);return url;
          }finally{clearTimeout(timer);if(pending.get(source)===entry)pending.delete(source);}
        })();pending.set(source,entry);
      }
      await pending.get(source).promise;
    }
    if(!current())return;
    img.onload=()=>{if(current())photoState(img,'loaded');};
    img.onerror=()=>{if(current()){
      const url=blobs.get(source);if(url===img.getAttribute('src')){blobs.delete(source);reverse.delete(url);URL.revokeObjectURL(url);}
      img.removeAttribute('src');photoState(img,'error');
    }};
    img.src=blobs.get(source);
  }catch{if(current()){img.removeAttribute('src');photoState(img,'error');}}
}
const photoObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){photoObserver.unobserve(entry.target);void loadPhoto(entry.target);}}});
function photo(img){
  const source=img.dataset.photoSrc;
  if(!source||!(source.startsWith(API+'/api/photos/')||source.startsWith('data:image/')))return;
  if(watched.get(img)===source)return;watched.set(img,source);photoObserver.unobserve(img);
  if(!window.hpmServerUser){img.removeAttribute('src');return;}
  photoState(img,'waiting');
  if(img.dataset.photoEager==='true')void loadPhoto(img);else photoObserver.observe(img);
}
window.hpmSetPhotoSource=(img,source,{eager=false}={})=>{
  photoObserver.unobserve(img);watched.delete(img);img.onload=null;img.onerror=null;img.removeAttribute('src');delete img.dataset.photoSrc;
  if(!source)return;
  if(source.startsWith(API+'/api/photos/')){img.dataset.photoSrc=source;img.dataset.photoEager=String(eager);photo(img);}
  else{photoState(img,'loading');img.onload=()=>photoState(img,'loaded');img.onerror=()=>photoState(img,'error');img.src=source;}
};
new MutationObserver(mutations=>{for(const m of mutations){
  if(m.type==='attributes')photo(m.target);
  for(const node of m.addedNodes||[]){if(node.nodeType!==1)continue;if(node.tagName==='IMG')photo(node);node.querySelectorAll?.('img[data-photo-src]').forEach(photo);}
  for(const node of m.removedNodes||[]){if(node.nodeType!==1)continue;const forget=img=>{photoObserver.unobserve(img);watched.delete(img);};if(node.tagName==='IMG')forget(node);node.querySelectorAll?.('img[data-photo-src]').forEach(forget);}
}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-photo-src']});
document.addEventListener('hpm:auth',()=>{if(!window.hpmServerUser){
  photoEpoch++;for(const entry of pending.values())entry.controller.abort();pending.clear();
  photoObserver.disconnect();blobs.forEach(url=>URL.revokeObjectURL(url));blobs.clear();reverse.clear();
  for(const img of document.querySelectorAll('img[data-photo-src]')){img.removeAttribute('src');watched.delete(img);}
}});
