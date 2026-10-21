// Only the explicit theme preference is persisted. Authentication and records are untouched.
(()=>{
  const key='hpmTheme',media=window.matchMedia('(prefers-color-scheme: dark)');
  let preference=null;try{const saved=localStorage.getItem(key);if(['light','dark'].includes(saved))preference=saved;}catch{}
  function apply(){
    const dark=(preference||(media.matches?'dark':'light'))==='dark';document.documentElement.dataset.theme=dark?'dark':'light';
    const button=document.getElementById('themeToggle');if(button){button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'라이트 모드로 전환':'다크 모드로 전환');button.title=button.getAttribute('aria-label');button.textContent=dark?'☀':'☾';}
  }
  apply();media.addEventListener('change',()=>{if(!preference)apply();});
  window.addEventListener('storage',e=>{if(e.key===key){preference=['light','dark'].includes(e.newValue)?e.newValue:null;apply();}});
  document.addEventListener('DOMContentLoaded',()=>{apply();document.getElementById('themeToggle')?.addEventListener('click',()=>{preference=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,preference);}catch{}apply();});});
})();
