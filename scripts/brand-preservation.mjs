// Read-only production evidence. Records and exports remain in ignored private folders.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {query,rows,hash,wrangler} from './production-lib.mjs';
const dir='.wrangler/brand-20261021';await mkdir(dir,{recursive:true});
const save=async(name,value)=>writeFile(dir+'/'+name+'.json',JSON.stringify(value,null,2));
const read=async name=>JSON.parse(await readFile(dir+'/'+name+'.json','utf8'));
const ordered=(db,table)=>{const columns=db.prepare('PRAGMA table_info("'+table+'")').all(),pk=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>'"'+c.name+'"');return db.prepare('SELECT * FROM "'+table+'" ORDER BY '+(pk.join(',')||'rowid')).all();};
async function snapshot(stage='before'){
  const schema=rows(await query("SELECT name,sql,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;")),data={},records={},keys=new Set();
  for(const table of schema.filter(t=>t.type==='table'&&!['portal_sessions','portal_auth_limits'].includes(t.name))){
    const cols=rows(await query('PRAGMA table_info("'+table.name+'");')),pk=cols.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>'"'+c.name+'"');
    const values=rows(await query('SELECT * FROM "'+table.name+'" ORDER BY '+(pk.join(',')||'rowid')+';'));
    data[table.name]={count:values.length,sha256:hash(values)};records[table.name]=values;
    for(const r of values){if(table.name==='issues')for(const value of [r.images,r.after_images]){let photos=[];try{photos=JSON.parse(value);}catch{}for(const src of Array.isArray(photos)?photos:[]){if(typeof src!=='string')continue;const key=src.startsWith('issues/')?src:src.split('/api/photos/')[1];if(key&&/^issues\/[A-Za-z0-9_-]+\/(before|after)\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(key))keys.add(key);}}if(['plan_imports','meal_menus'].includes(table.name)&&r.file_key)keys.add(r.file_key);}
  }
  const files=[];for(const key of keys){const file=dir+'/'+stage+'-object-'+hash(key);await wrangler(['r2','object','get','hpm-photos/'+key,'--remote','--file',file]);const bytes=await readFile(file);files.push({key,size:bytes.length,sha256:hash(bytes)});}
  return {manifest:{schemaHash:hash(schema),data,files},records};
}
if(process.argv[2]==='baseline'){
  try{await read('before');throw new Error('Existing evidence must not be overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const {manifest,records}=await snapshot();await save('before',manifest);await save('records-before',records);
  await mkdir('backups',{recursive:true});const file='backups/hpmanagement-before-brand-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql';
  await wrangler(['d1','export','DB','--remote','--output',file]);const bytes=await readFile(file),db=new DatabaseSync(':memory:');
  try{db.exec(bytes.toString('utf8'));for(const [name,expected] of Object.entries(manifest.data))assert.deepEqual({count:ordered(db,name).length,sha256:hash(ordered(db,name))},expected,name);}finally{db.close();}
  await save('backup',{file,size:bytes.length,sha256:hash(bytes),localRestoreVerified:true});
  const comparisons=[];
  for(const old of (await readdir('backups')).filter(n=>n.endsWith('.sql')&&!file.endsWith(n))){
    const sql=await readFile('backups/'+old,'utf8'),previous=new DatabaseSync(':memory:');
    try{previous.exec(sql);const prior=ordered(previous,'issues'),missing=prior.filter(p=>!records.issues.some(r=>r.id===p.id)),changed=prior.filter(p=>{const current=records.issues.find(r=>r.id===p.id);return current&&Object.keys(p).some(k=>p[k]!==current[k]);});comparisons.push({backup:old,count:prior.length,missingIds:missing.length,changedExistingRows:changed.length});}finally{previous.close();}
  }
  const fire=await(await fetch('https://hpmanagement-web.lotusland1995.workers.dev/api/fire-status?year=2026&month=10')).json();await save('fire-before',fire);await save('history-comparison',comparisons);
  console.log(JSON.stringify({tables:Object.keys(manifest.data).length,issues:manifest.data.issues.count,as:manifest.data.as_events.count,team:manifest.data.team_events.count,referenceFiles:manifest.files.length,backupVerified:true,comparisons}));
}else if(process.argv[2]==='verify'){
  const after=await snapshot('after'),before=await read('before');assert.deepEqual(after.manifest,before,'Production data/schema/files changed. Review private evidence.');await save('after',after.manifest);
  const current=await(await fetch('https://hpmanagement-web.lotusland1995.workers.dev/api/fire-status?year=2026&month=10')).json(),prior=await read('fire-before');assert.deepEqual(current.summary,prior.summary);assert.deepEqual(current.companies,prior.companies);
  console.log('PASS 운영 계정·업무 데이터·스키마·참조 파일·소화기 집계 보존.');
}else throw new Error('Use baseline or verify. No production writes are provided.');
