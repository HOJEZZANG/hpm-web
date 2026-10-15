// Build an ignored recovery package without restoring public historical snapshots.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseHTML} from 'linkedom';
import {load,save} from './production-lib.mjs';
const target='.wrangler/recovery';await mkdir(target,{recursive:true});
const {document}=parseHTML(await readFile('index.html','utf8'));
for(const n of [0,1,2])document.getElementById('businessMenu'+n)?.parentElement.remove();
for(const name of ['notices','search'])document.querySelector(`[data-page="${name}"]`)?.remove();
const module=document.querySelector('script[type="module"]');
module.textContent=`import {createPresentation} from './business/ui/presentation.js';window.createHpmPresentation=createPresentation;
document.addEventListener('hpm:navigate',async e=>{if(e.detail!=='accounts')return;const root=document.getElementById('accountsPage');root.replaceChildren();if(window.hpmServerUser?.role!=='admin'){root.textContent='관리자 로그인이 필요합니다.';return;}try{const data=await window.apiRequest('/api/auth/users');for(const u of data.users){const row=document.createElement('p');row.textContent=u.id+' / '+u.name+' / '+u.status+' ';if(u.role!=='admin')for(const status of ['active','disabled']){const b=document.createElement('button');b.className='btn';b.textContent=status==='active'?'승인':'비활성';b.onclick=async()=>{b.disabled=true;try{await window.apiRequest('/api/auth/users/'+u.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});row.textContent=u.id+' / '+status;}catch{b.disabled=false;}};row.append(b);}root.append(row);}}catch{root.textContent='사용자 조회 실패. 다시 열어 주세요.';}});await window.startHpmPortal();`;
await writeFile(target+'/index.html',document.toString());
await writeFile(target+'/worker.mjs',`import primary from '../../worker.js';export default {fetch(request,env,ctx){if(new URL(request.url).pathname.startsWith('/api/business/'))return new Response(JSON.stringify({error:'신규 업무 점검 중입니다. 기존 기능은 이용할 수 있습니다.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://hojezzang.github.io','Vary':'Origin'}});return primary.fetch(request,env,ctx);}};`);
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));config.main=resolve(target+'/worker.mjs');await writeFile(target+'/wrangler.jsonc',JSON.stringify(config,null,2));
const deployments=await load('deployments-before'),previous=deployments.toSorted((a,b)=>a.created_on.localeCompare(b.created_on)).at(-1).versions[0].version_id;
await save('recovery',{previousWorkerVersion:previous,originalGit:'5e684ca',secureCorePackage:target,preparedAt:new Date().toISOString()});
console.log(JSON.stringify({previousWorkerVersion:previous,secureCorePackage:target,prepared:true}));
