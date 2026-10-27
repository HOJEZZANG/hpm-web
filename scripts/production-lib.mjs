// Operator-only CLI helpers. Full management output stays in ignored local files.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
export const dir='.wrangler/production';
await mkdir(dir,{recursive:true});
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export function cliJson(output){const start=output.search(/^[\[{]/m);if(start<0)throw new Error('Cloudflare JSON 응답이 없습니다.');try{return JSON.parse(output.slice(start));}catch{throw new Error('Cloudflare JSON 응답 형식을 확인하세요.');}}
export async function wrangler(args){
  // Preserve multibyte cells across chunks and wait until both output streams close.
  return new Promise((resolve,reject)=>{let out='',err='';const p=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',async code=>{if(code!==0){await writeFile(dir+'/last-error.log',out+'\n'+err);reject(new Error('Cloudflare 작업 실패. 비공개 .wrangler/production/last-error.log 확인 필요.'));}else resolve(out);});});
}
export async function query(sql){
  return cliJson(await wrangler(['d1','execute','DB','--remote','--command',sql,'--json']));
}
export async function executePrivateSql(sql){
  const file=dir+'/'+randomUUID()+'.sql';await writeFile(file,sql,{mode:0o600});
  try{return cliJson(await wrangler(['d1','execute','DB','--remote','--file',file,'--json']));}finally{await unlink(file);}
}
export async function save(name,value){await writeFile(dir+'/'+name+'.json',JSON.stringify(value,null,2),{mode:0o600});}
export const load=async name=>JSON.parse(await readFile(dir+'/'+name+'.json','utf8'));
export const rows=result=>result.flatMap(x=>x.results||[]);
export const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function tableSnapshot(tables){
  const data={};for(const [table,columns] of Object.entries(tables)){const r=rows(await query('SELECT '+columns.map(c=>'"'+c+'"').join(',')+' FROM "'+table+'" ORDER BY id;'));data[table]={count:r.length,sha256:hash(r)};}return data;
}
