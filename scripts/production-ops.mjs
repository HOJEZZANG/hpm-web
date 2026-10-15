import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {wrangler,query,save,load,rows,hash,tableSnapshot,quote,cliJson} from './production-lib.mjs';
const mode=process.argv[2],base='https://hpmanagement-web.lotusland1995.workers.dev';
if(mode==='inspect'){
  const schema=rows(await query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"));
  const tables={};for(const name of ['issues','as_events','team_events']){assert(schema.some(t=>t.name===name),'Existing table missing');tables[name]=rows(await query('PRAGMA table_info("'+name+'");')).map(c=>c.name);}
  await save('schema-before',schema);await save('columns-before',tables);const snapshot=await tableSnapshot(tables);await save('data-before',snapshot);
  const versions=cliJson(await wrangler(['versions','list','--json']));await save('versions-before',versions);
  const deployments=cliJson(await wrangler(['deployments','list','--json']));await save('deployments-before',deployments);
  if(schema.some(t=>t.name==='d1_migrations'))await save('migrations-before',rows(await query('SELECT * FROM d1_migrations ORDER BY id;')));
  const today=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'})),firePath='/api/fire-status?year='+today.getFullYear()+'&month='+(today.getMonth()+1);
  const fire=await fetch(base+firePath);const fireBody=await fire.text();await save('fire-before',{path:firePath,status:fire.status,body:fireBody,sha256:hash(fireBody)});
  const issues=await fetch(base+'/api/issues');assert.equal(issues.status,200);const body=await issues.json();await save('issues-api-before',body);
  const urls=[...new Set((body.issues||[]).flatMap(i=>[...(i.images||[]),...(i.afterImages||[])]).filter(u=>typeof u==='string'&&u.startsWith(base+'/api/photos/')))];
  const photos=[];for(const url of urls){const r=await fetch(url);const b=Buffer.from(await r.arrayBuffer());photos.push({url,status:r.status,size:b.length,sha256:hash(b)});}await save('photos-before',photos);
  const page=await fetch('https://hojezzang.github.io/hpm-web/');await writeFile('.wrangler/production/pages-before.html',await page.text());
  console.log(JSON.stringify({schemaTables:schema.map(t=>t.name),legacy:snapshot,photoReferences:photos.length,photosReadable:photos.filter(p=>p.status===200).length,fireStatus:fire.status,versionsCaptured:true,deploymentsCaptured:true}));
}else if(mode==='backup'){
  await mkdir('backups',{recursive:true});const file='backups/hpmanagement-before-part1-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql';
  await wrangler(['d1','export','DB','--remote','--output',file]);const bytes=await readFile(file);assert(bytes.length>100);assert(bytes.includes(Buffer.from('CREATE TABLE')));await save('backup',{file,size:bytes.length,sha256:hash(bytes),at:new Date().toISOString()});console.log(JSON.stringify(await load('backup')));
}else if(mode==='migrate'){
  await load('backup');const schema=rows(await query("SELECT name FROM sqlite_master WHERE type='table';"));
  assert(!schema.some(t=>['weekly_issues','portal_accounts'].includes(t.name)),'New tables already exist; manual review required');
  for(const name of ['0004_part1_business.sql','0005_server_identity.sql']){await wrangler(['d1','execute','DB','--remote','--file','migrations/'+name,'--json']);if(schema.some(t=>t.name==='d1_migrations'))await query('INSERT INTO d1_migrations(name) VALUES('+quote(name)+');');}
  await save('migrations-applied',{names:['0004_part1_business.sql','0005_server_identity.sql'],at:new Date().toISOString()});console.log('신규 0004·0005 적용 완료. 기존 migration 재실행 없음.');
}else if(mode==='preservation'){
  const before=await load('data-before'),after=await tableSnapshot(await load('columns-before'));assert.deepEqual(after,before);await save('data-after',after);console.log(JSON.stringify({preserved:true,tables:after}));
}else if(mode==='deploy'){
  const out=await wrangler(['deploy']);await writeFile('.wrangler/production/deploy.log',out);const version=out.match(/Current Version ID:\s*([a-f0-9-]+)/i)?.[1];assert(version,'Deployment version missing');await save('deployment',{version,at:new Date().toISOString(),url:base});console.log(JSON.stringify(await load('deployment')));
}else throw new Error('Expected inspect, backup, migrate, preservation or deploy');
