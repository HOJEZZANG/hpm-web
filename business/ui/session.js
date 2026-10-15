// Only session credentials stay in this browser tab. All shared records live on the server.
const API=['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'https://hpmanagement-web.lotusland1995.workers.dev';
window.hpmServerUser=null;
window.authorizedFetch=(path,options={})=>{
  const url=path.startsWith('/')?API+path:path,headers=new Headers(options.headers);
  if(url.startsWith(API+'/api/')){const token=sessionStorage.getItem('hpmServerToken');if(token)headers.set('Authorization','Bearer '+token);}
  return fetch(url,{...options,headers});
};
const blobs=new Map(),reverse=new Map(),pending=new Map();
window.hpmCanonicalPhoto=value=>reverse.get(value)||value;
async function photo(img){
  const source=img.getAttribute('src');if(!source?.startsWith(API+'/api/photos/'))return;
  if(!window.hpmServerUser){img.removeAttribute('src');return;}
  if(!blobs.has(source)){
    if(!pending.has(source))pending.set(source,(async()=>{const r=await window.authorizedFetch(source);if(!r.ok)throw new Error('사진을 읽을 수 없습니다.');const url=URL.createObjectURL(await r.blob());blobs.set(source,url);reverse.set(url,source);return url;})().finally(()=>pending.delete(source)));
    try{await pending.get(source);}catch{if(img.getAttribute('src')===source){img.removeAttribute('src');img.alt='사진 조회 실패 · 새로 조회해 주세요.';}return;}
  }
  if(img.getAttribute('src')===source)img.src=blobs.get(source);
}
new MutationObserver(mutations=>{for(const m of mutations){if(m.type==='attributes'&&m.target.tagName==='IMG')void photo(m.target);for(const node of m.addedNodes||[]){if(node.nodeType!==1)continue;if(node.tagName==='IMG')void photo(node);node.querySelectorAll?.('img').forEach(img=>void photo(img));}}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
document.addEventListener('hpm:auth',()=>{if(!window.hpmServerUser){blobs.forEach(url=>URL.revokeObjectURL(url));blobs.clear();reverse.clear();}});
