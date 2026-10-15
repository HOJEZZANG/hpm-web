// Read-only deployment checks. No credentials or business write requests.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {hash,save,load} from './production-lib.mjs';
const site='https://hojezzang.github.io/hpm-web/',api='https://hpmanagement-web.lotusland1995.workers.dev';
const assets=['index.html',...(await readdir('business/ui')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'business/ui/'+f)];
for(const path of assets){const r=await fetch(site+(path==='index.html'?'':path),{cache:'no-store'});assert.equal(r.status,200,path);assert.equal(hash(await r.text()),hash((await readFile(path,'utf8')).replaceAll('\r\n','\n')),path+' differs');}
for(const path of ['/api/issues','/api/as-events','/api/team-events','/api/business/weekly','/api/business/vehicles','/api/business/people','/api/business/safety','/api/business/imports?kind=production','/api/business/orders','/api/auth/users',...(await load('photos-before')).map(p=>new URL(p.url).pathname)]){assert.equal((await fetch(api+path)).status,401,path);}
assert.equal((await fetch(api+'/api/health')).status,200);
const status=await(await fetch(api+'/api/auth/status')).json();assert.equal(status.setupRequired,false);
const fireBefore=await load('fire-before'),fire=await fetch(api+fireBefore.path);assert.equal(fire.status,200);const current=await fire.json(),prior=JSON.parse(fireBefore.body);assert.deepEqual(current.summary,prior.summary);assert.deepEqual(current.companies,prior.companies);
const report={pagesAssetsMatched:assets.length,protectedAnonymousRequestsRejected:true,health:200,firstAdminSetupClosed:true,fireAggregateUnchanged:true,at:new Date().toISOString()};await save('public-verification',report);console.log(JSON.stringify(report));
