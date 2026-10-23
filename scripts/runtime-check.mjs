// Execute the bundled Worker in workerd with real local D1/R2 bindings.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {template,createWorkbook} from '../business/excel.mjs';
import {writeTable} from '../business/ooxml.mjs';
import {parseProductionSheet} from '../business/production-sheet.mjs';
import {randomBytes,createHash} from 'node:crypto';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/build/worker.js',compatibilityDate:'2026-09-15',d1Databases:['DB'],r2Buckets:['PHOTOS'],bindings:{PORTAL_BOOTSTRAP_SECRET:'synthetic-runtime-bootstrap-key-0000'}}));
try{
  const db=await mf.getD1Database('DB');
  for(const file of ['0001_cloudflare_schema.sql','0003_shared_calendars.sql','0004_part1_business.sql','0005_server_identity.sql']){
    const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--.*$/gm,'').trim();
    const statements=sql.split(/;\s*(?=(?:CREATE|ALTER)\b)/i).map(s=>s.trim().replace(/;$/,'')).filter(Boolean);
    for(const statement of statements)await db.prepare(statement).run();
  }
  const base='http://local.test';let token;
  async function req(path,method='GET',body){const response=await mf.dispatchFetch(base+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,await response.clone().text());return response.json();}
  const account={id:'runtime-admin',name:'합성 런타임 관리자',password:'synthetic-runtime-password',bootstrapSecret:'synthetic-runtime-bootstrap-key-0000'};
  await req('/api/auth/bootstrap','POST',account);token=(await req('/api/auth/login','POST',account)).token;
  await req('/api/business/weekly/runtime','PUT',{date:'2027-01-01',part:'1 PART',product:'합성 런타임',problem:'합성 문제',manager:'합성 담당'});
  assert.equal((await req('/api/business/weekly?week=2027-01-01')).records[0].key,'2026-W53');
  const form=new FormData();form.set('kind','production');form.set('file',new File([await template('production')],'runtime.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const uploadRequest=new Request(base+'/api/business/imports',{method:'POST',headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+token},body:form});
  const response=await mf.dispatchFetch(uploadRequest.url,{method:'POST',headers:Object.fromEntries(uploadRequest.headers),body:new Uint8Array(await uploadRequest.arrayBuffer())});assert.equal(response.status,200,await response.clone().text());const preview=await response.json();assert.equal(preview.applyCount,1);
  await req('/api/business/imports/'+preview.id+'/apply','POST');assert.equal((await req('/api/business/production?import='+preview.id)).records.length,1);
  const file=await mf.dispatchFetch(base+'/api/business/imports/'+preview.id+'/file',{headers:{Authorization:'Bearer '+token}});assert.equal(file.status,200);assert.ok((await file.arrayBuffer()).byteLength>0);
  const big=new FormData();big.set('kind','production');big.set('file',new File([await createWorkbook(['PND','현공정','수량','분류'],Array.from({length:500},(_,i)=>({PND:'2026-10-15','현공정':'조립','수량':1,'분류':'AC'})))],'synthetic-500.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const bigRequest=new Request(base+'/api/business/imports',{method:'POST',headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+token},body:big});const bigResponse=await mf.dispatchFetch(bigRequest.url,{method:'POST',headers:Object.fromEntries(bigRequest.headers),body:new Uint8Array(await bigRequest.arrayBuffer())});assert.equal(bigResponse.status,200,await bigResponse.clone().text());const bigPreview=await bigResponse.json();assert.equal(bigPreview.applyCount,500);await req('/api/business/imports/'+bigPreview.id+'/apply','POST');assert.equal((await req('/api/business/production?import='+bigPreview.id+'&equipment=AC')).records.length,500);
  const exported=await mf.dispatchFetch(base+'/api/business/production?import='+bigPreview.id+'&download=1',{headers:{Authorization:'Bearer '+token}});assert.equal(exported.status,200);assert.ok((await exported.arrayBuffer()).byteLength>1000);
  await req('/api/business/vehicles/runtime-car','PUT',{number:'합성 런타임 차량'});
  const cols=['PND','현공정','수량','분류',...Array.from({length:50},(_,i)=>'추가'+i)],rawRows=Array.from({length:620},(_,i)=>['2026-10-23','조립',i,'AC',...Array.from({length:50},()=>randomBytes(85).toString('hex'))]),source=writeTable(cols,rawRows),plan=parseProductionSheet(source),v2id=crypto.randomUUID();assert(source.length>2*1024*1024);
  await req('/api/business/imports/start','POST',{id:v2id,filename:'합성-620.xlsx',sha256:createHash('sha256').update(source).digest('hex'),size:source.length,meta:plan.meta});
  const original=await mf.dispatchFetch(base+'/api/business/imports/'+v2id+'/file',{method:'PUT',headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:source});assert.equal(original.status,200,await original.clone().text());
  for(let i=0;i<plan.rows.length;i+=20){const body={rows:plan.rows.slice(i,i+20)};await req('/api/business/imports/'+v2id+'/chunk','POST',body);if(i===0)await req('/api/business/imports/'+v2id+'/chunk','POST',body);}
  await req('/api/business/imports/'+v2id+'/ready','POST');await req('/api/business/imports/'+v2id+'/apply','POST');assert.equal((await req('/api/business/production?import='+v2id+'&offset=600')).records.length,20);assert.equal((await db.prepare('SELECT count(*) n FROM production_rows WHERE import_id=?').bind(v2id).first()).n,620);
  const booking={vehicleId:'runtime-car',date:'2026-10-15',start:'09:00',end:'12:00',applicant:'합성 신청자',purpose:'동시성 검증'};
  const concurrent=await Promise.all(['one','two'].map(id=>mf.dispatchFetch(base+'/api/business/bookings/'+id,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(booking)})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  await req('/api/business/people/runtime-person','PUT',{name:'합성 식수 인원'});
  const meal={person_id:'runtime-person',day:'2026-10-15',breakfast:0,lunch:1,dinner:0,revision:0};await req('/api/business/meals?week=2026-10-15','PUT',{records:[meal]});
  const stale=await mf.dispatchFetch(base+'/api/business/meals?week=2026-10-15',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({records:[{...meal,lunch:0},{...meal,day:'2026-10-16'}]})});assert.equal(stale.status,409,await stale.clone().text());assert.equal((await req('/api/business/meals?week=2026-10-15')).records.length,1);
  console.log('PASS bundled workerd: existing migrations / server login / legacy XLSX / >2MiB, 620-row, 54-column staged XLSX with retry and real D1 JSON/R2 / simultaneous booking conflict / atomic meal rollback. No remote requests.');
}finally{await mf.dispose();}
