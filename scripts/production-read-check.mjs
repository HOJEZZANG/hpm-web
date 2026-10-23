// Read-only deployment checks. No credentials or business write requests.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {hash,save} from './production-lib.mjs';
const site='https://hojezzang.github.io/hpm-web/',api='https://hpmanagement-web.lotusland1995.workers.dev';
const evidence=process.argv[2]||'.wrangler/brand-20261021';
const assets=['index.html','assets/hi-air-korea-logo.png','assets/xlsx-worker.js',...(await readdir('business/ui')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'business/ui/'+f)];
for(const path of assets){const r=await fetch(site+(path==='index.html'?'':path),{cache:'no-store'});assert.equal(r.status,200,path);const actual=path.endsWith('.png')?Buffer.from(await r.arrayBuffer()):await r.text(),expected=path.endsWith('.png')?await readFile(path):(await readFile(path,'utf8')).replaceAll('\r\n','\n');assert.equal(hash(actual),hash(expected),path+' differs');}
const baseline=JSON.parse(await readFile(evidence+'/before.json','utf8'));
for(const path of ['/api/issues','/api/issues/draft','/api/as-events','/api/team-events','/api/business/weekly','/api/business/vehicles','/api/business/people','/api/business/safety','/api/business/imports?kind=production','/api/business/orders','/api/business/imports/missing/file','/api/business/menus/missing','/api/auth/users',...baseline.files.filter(p=>p.key.startsWith('issues/')).map(p=>'/api/photos/'+p.key)]){const r=await fetch(api+path,{headers:{'X-User-Id':'owner','X-Role':'admin',Cookie:'productionPortalSessionV1=owner'}});assert.equal(r.status,401,path);assert.equal((await r.json()).code,'AUTH_REQUIRED');}
assert.equal((await fetch(api+'/api/health')).status,200);
const status=await(await fetch(api+'/api/auth/status')).json();assert.equal(status.setupRequired,false);
const prior=JSON.parse(await readFile(evidence+'/fire-before.json','utf8')),fire=await fetch(api+'/api/fire-status?year=2026&month=10');assert.equal(fire.status,200);const current=await fire.json();assert.deepEqual(current.summary,prior.summary);assert.deepEqual(current.companies,prior.companies);
const report={pagesAssetsMatched:assets.length,logoBytesMatched:true,detailModuleAndThemeBytesMatched:true,protectedAnonymousRequestsRejected:true,health:200,firstAdminSetupClosed:true,fireAggregateUnchanged:true,at:new Date().toISOString()};await save('public-verification',report);console.log(JSON.stringify(report));
