// Read-only production smoke test; never sends writes to either data store.
import assert from 'node:assert/strict';
const base = 'https://hpmanagement-web.lotusland1995.workers.dev';
const origin = 'https://hojezzang.github.io';
async function get(path, status=200, method='GET') {
  const response=await fetch(base+path,{method,headers:{Origin:origin},signal:AbortSignal.timeout(25000)});
  assert.equal(response.status,status,path);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  if (method==='OPTIONS') return;
  const text=await response.text();
  assert.ok(!/sb_publishable_[A-Za-z0-9_-]+/.test(text));
  const result=JSON.parse(text);
  if (path.startsWith('/api/fire-status')) {
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.ok(!/https?:\/\/|inspected_at|apikey|"photo"|"memo"|"manager"/.test(text));
  }
  return result;
}
const result=await get('/api/fire-status?year=2026&month=09');
assert.equal(result.ok,true);
assert.equal(result.year,2026);assert.equal(result.month,9);
assert.ok(Array.isArray(result.companies));
for (const row of result.companies) {
  assert.deepEqual(Object.keys(row).sort(),['company','total','normal','abnormal','pending','inspectionRate'].sort());
  assert.ok(row.normal+row.abnormal+row.pending<=row.total);
}
for (const field of ['total','normal','abnormal','pending']) assert.equal(result.summary[field],result.companies.reduce((sum,row)=>sum+row[field],0));
assert.equal(result.summary.inspectionRate,result.summary.total ? Math.round((result.summary.normal+result.summary.abnormal)/result.summary.total*100) : 0);
for (const query of ['', '?year=invalid&month=9','?year=2026&month=0','?year=2026&month=13']) await get('/api/fire-status'+query,400);
await get('/api/fire-status',204,'OPTIONS');
const health=await get('/api/health');assert.equal(health.database,true);assert.equal(health.photos,true);
const issues=await get('/api/issues');
let checkedPhoto=false;
for (const issue of issues.issues) {
  const photo=[...(issue.images||[]),...(issue.afterImages||[])].find(url=>url.startsWith(base+'/api/photos/'));
  if (!photo) continue;
  const response=await fetch(photo,{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^image\//);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  await response.arrayBuffer();checkedPhoto=true;break;
}
console.log(JSON.stringify({fireStatus:200,companyCount:result.companies.length,summary:result.summary,existingPhoto:checkedPhoto?'GET 200':'no existing photo available'}));
console.log('PASS remote fire API, input validation, response minimization, CORS, health and existing photo read.');
