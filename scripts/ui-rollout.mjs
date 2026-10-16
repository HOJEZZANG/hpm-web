// Private baseline for the UI rollout; never prints records, identities or credentials.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {query,rows,hash,wrangler,cliJson} from './production-lib.mjs';
import {DatabaseSync} from 'node:sqlite';
const dir='.wrangler/ui-rollout';await mkdir(dir,{recursive:true});
const save=async(name,data)=>writeFile(dir+'/'+name+'.json',JSON.stringify(data,null,2));
const load=async name=>JSON.parse(await readFile(dir+'/'+name+'.json','utf8'));
async function snapshot(){
  const schema=rows(await query("SELECT name,sql,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;"));
  const data={},objects=new Set();
  for(const t of schema.filter(t=>t.type==='table'&&!['portal_sessions','portal_auth_limits'].includes(t.name))){
    const columns=rows(await query('PRAGMA table_info("'+t.name+'");')),pk=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>'"'+c.name+'"');
    const r=rows(await query('SELECT * FROM "'+t.name+'" ORDER BY '+(pk.join(',')||'rowid')+';'));
    data[t.name]={count:r.length,sha256:hash(r)};
    for(const row of r){if(t.name==='issues')for(const v of [row.images,row.after_images]){let list=[];try{list=JSON.parse(v);}catch{}if(Array.isArray(list))for(const item of list){if(typeof item!=='string')continue;const key=item.startsWith('issues/')?item:item.split('/api/photos/')[1];if(key&&/^issues\/[A-Za-z0-9_-]+\/(before|after)\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(key))objects.add(key);}}if(['plan_imports','meal_menus'].includes(t.name)&&row.file_key)objects.add(row.file_key);}
  }
  const files=[];for(const key of objects){const file=dir+'/object-'+hash(key);await wrangler(['r2','object','get','hpm-photos/'+key,'--remote','--file',file]);const bytes=await readFile(file);files.push({key,size:bytes.length,sha256:hash(bytes)});}
  return {schemaHash:hash(schema),data,files};
}
if(process.argv[2]==='baseline'){
  const result=await snapshot();await save('before',result);
  const deployments=cliJson(await wrangler(['deployments','list','--json']));await save('deployments-before',deployments);const latest=deployments.toSorted((a,b)=>a.created_on.localeCompare(b.created_on)).at(-1);await save('recovery',{commit:'62f6b65',version:latest.versions[0].version_id});
  const fire=await(await fetch('https://hpmanagement-web.lotusland1995.workers.dev/api/fire-status?year=2026&month=10')).json();await save('fire-before',fire);
  await writeFile(dir+'/pages-before.html',await(await fetch('https://hojezzang.github.io/hpm-web/')).text());
  console.log(JSON.stringify({baseline:true,tables:Object.keys(result.data).length,referenceFiles:result.files.length,recoveryVersion:latest.versions[0].version_id}));
}else if(process.argv[2]==='backup'){
  const before=await load('before');await mkdir('backups',{recursive:true});const file='backups/hpmanagement-before-ui-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql';await wrangler(['d1','export','DB','--remote','--output',file]);const bytes=await readFile(file),db=new DatabaseSync(':memory:');
  try{db.exec(bytes.toString('utf8'));for(const [table,expected] of Object.entries(before.data)){const columns=db.prepare('PRAGMA table_info("'+table+'")').all(),pk=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>'"'+c.name+'"');const data=db.prepare('SELECT * FROM "'+table+'" ORDER BY '+(pk.join(',')||'rowid')).all();assert.equal(data.length,expected.count,table);assert.equal(hash(data),expected.sha256,table);}}finally{db.close();}
  await save('backup',{file,size:bytes.length,sha256:hash(bytes),localRestoreVerified:true,at:new Date().toISOString()});console.log('PASS D1 백업 확보 및 로컬 메모리 복원. 계정/업무 테이블 모두 기준 해시 일치.');
}else if(process.argv[2]==='verify'){
  const after=await snapshot(),before=await load('before');assert.deepEqual(after,before,'Production data/schema/reference files changed; private manifests need review');await save('after',after);
  const fire=await(await fetch('https://hpmanagement-web.lotusland1995.workers.dev/api/fire-status?year=2026&month=10')).json(),prior=await load('fire-before');assert.deepEqual(fire.summary,prior.summary);assert.deepEqual(fire.companies,prior.companies);await save('preservation',{allAccountsAndBusinessDataUnchanged:true,referencedFilesUnchanged:true,fireUnchanged:true,at:new Date().toISOString()});console.log('PASS 운영 계정/업무 데이터/스키마/참조 파일/소화기 집계 보존. 운영 업무 쓰기 없음.');
}else throw new Error('Expected baseline, backup or verify');
