import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const provider = 'SUPA' + 'BASE';
const env = { ['FIRE_'+provider+'_URL']: 'https://fire.example', ['FIRE_'+provider+'_KEY']: 'sb_'+'publishable_mock' };
const origin = 'https://hojezzang.github.io';
const valid = '?year=2026&month=09';
function request(query=valid, bindings=env, method='GET') {
  return worker.fetch(new Request('https://worker.example/api/fire-status'+query, {method,headers:{Origin:origin}}), bindings);
}
function reply(data, total=data.length) {
  return new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,data.length-1)}/${total}`}});
}
function mockRows(t, fires=[], history=[]) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({url:new URL(url),options});
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'manual');
    assert.equal(options.headers.apikey,env['FIRE_'+provider+'_KEY']);
    assert.equal(options.headers.Authorization,undefined);
    return reply(new URL(url).pathname.endsWith('fire_extinguishers') ? fires : history);
  });
  return calls;
}
const fire = (no, company='A') => ({no,company});
const inspection = (no,status='정상',inspected_at='2026-09-05T00:00:00Z')=>({no,status,inspected_at});

test('required year/month, invalid year/month, duplicates and read-only methods', async t=>{
  const calls=mockRows(t);
  for (const query of ['', '?year=2026','?month=9','?year=no&month=9','?year=26&month=9',
    '?year=1899&month=9','?year=9999&month=9','?year=2026&month=0','?year=2026&month=13',
    '?year=2026&month=-1','?year=2026&month=1.5','?year=2026&month=09&month=10','?year=2026&year=2025&month=9']) {
    assert.equal((await request(query)).status,400,query);
  }
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await request(valid,env,method)).status,405);
  assert.equal(calls.length,0);
});
test('bindings required; privileged or malformed key and endpoint rejected',async t=>{
  const calls=mockRows(t);
  for (const bindings of [{},{['FIRE_'+provider+'_URL']:env['FIRE_'+provider+'_URL']},
    {['FIRE_'+provider+'_KEY']:env['FIRE_'+provider+'_KEY']},
    {...env,['FIRE_'+provider+'_KEY']:'sb_secret_forbidden'},
    {...env,['FIRE_'+provider+'_KEY']:'eyJ.invalid.jwt'},
    {...env,['FIRE_'+provider+'_URL']:'http://fire.example'}]) assert.equal((await request(valid,bindings)).status,503);
  assert.equal(calls.length,0);
});
test('empty list; minimal SELECT, Korean month bounds, no-store and CORS',async t=>{
  const calls=mockRows(t);
  const res=await request();
  assert.equal(res.status,200); assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await res.json(),{ok:true,year:2026,month:9,companies:[],summary:{total:0,normal:0,abnormal:0,pending:0,inspectionRate:0}});
  assert.deepEqual(calls.map(c=>c.url.searchParams.get('select')),['no,company','no,status,inspected_at']);
  assert.equal(calls[1].url.searchParams.get('and'),'(inspected_at.gte.2026-08-31T15:00:00.000Z,inspected_at.lt.2026-09-30T15:00:00.000Z)');
});
test('empty history counts every master as pending',async t=>{
  mockRows(t,[fire('1'),fire('2')]);
  assert.deepEqual((await (await request()).json()).summary,{total:2,normal:0,abnormal:0,pending:2,inspectionRate:0});
});
test('company grouping, normal/abnormal/pending, totals, rounding, latest monthly inspection',async t=>{
  mockRows(t,[fire('1'),fire('2'),fire('3'),fire('4','B'),fire('5','B')],
    [inspection('1','이상','2026-09-01'),inspection('1','정상','2026-09-02'),inspection('2','이상'),inspection('4'),
      inspection('3','정상','2026-08-31'),inspection('3','정상','2025-09-05'),inspection('ghost')]);
  const result=await (await request()).json();
  assert.deepEqual(result.companies,[{company:'A',total:3,normal:1,abnormal:1,pending:1,inspectionRate:67},
    {company:'B',total:2,normal:1,abnormal:0,pending:1,inspectionRate:50}]);
  assert.deepEqual(result.summary,{total:5,normal:2,abnormal:1,pending:2,inspectionRate:60});
});
test('source semantics for unknown status, missing fields and numeric legacy IDs; safe company names',async t=>{
  mockRows(t,[fire('1'),fire(2),fire('3',null),fire('4','__proto__'),{},null],
    [inspection('1','legacy'),inspection('2'),inspection('3',null),inspection('4','이상'),inspection(null),null,{},inspection('5','정상','invalid')]);
  const result=await (await request()).json();
  assert.equal(result.companies[0].inspectionRate,100);
  assert.deepEqual(result.summary,{total:5,normal:1,abnormal:1,pending:1,inspectionRate:40});
  assert.equal(result.companies[1].company,'미지정');
  assert.equal(result.companies[2].company,'__proto__');
});
test('Korean boundaries, naive legacy local timestamp, same timestamp first row wins',async t=>{
  mockRows(t,['1','2','3','4'].map(no=>fire(no)),[
    inspection('1','정상','2026-08-31T15:00:00Z'),inspection('2','정상','2026-09-30T15:00:00Z'),
    inspection('3','정상','2026-09-01T00:00:00'),inspection('4','이상'),inspection('4','정상')]);
  assert.deepEqual((await (await request()).json()).summary,{total:4,normal:2,abnormal:1,pending:1,inspectionRate:75});
});
test('rounds half percent upward',async t=>{
  mockRows(t,Array.from({length:8},(_,i)=>fire(String(i))),[inspection('0')]);
  assert.equal((await (await request()).json()).summary.inspectionRate,13);
});
test('response excludes all raw fields and credentials even if upstream returns extras',async t=>{
  mockRows(t,[{...fire('private-id'),manager:'private-manager',photo:'private-photo',zone:'private-zone'}],
    [{...inspection('private-id'),memo:'private-memo',apikey:env['FIRE_'+provider+'_KEY']}]);
  const text=await (await request()).text();
  for (const value of ['private-', 'fire.example', env['FIRE_'+provider+'_KEY'],'inspected_at','apikey']) assert.ok(!text.includes(value));
  assert.deepEqual(Object.keys(JSON.parse(text)),['ok','year','month','companies','summary']);
});
test('pagination respects actual server page sizes instead of assuming 1000 rows',async t=>{
  const offsets=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);
    if (u.pathname.endsWith('fire_inspection_history')) return reply([]);
    const offset=Number(u.searchParams.get('offset')); offsets.push(offset);
    return reply([fire(String(offset))],3);
  });
  assert.equal((await (await request()).json()).summary.total,3);
  assert.deepEqual(offsets,[0,1,2]);
});
test('upstream errors have distinct sanitized internal logs and generic client messages',async t=>{
  for (const [status,kind] of [[401,'access_denied'],[403,'access_denied'],[400,'query_rejected'],[503,'unavailable']]) {
    await t.test(String(status),async t=>{
      const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
      t.mock.method(globalThis,'fetch',async()=>new Response('private upstream body',{status}));
      const res=await request();assert.equal(res.status,502);
      assert.ok(!JSON.stringify(await res.json()).includes('private'));
      assert.ok(logs.some(log=>log[1].kind===kind));
      assert.ok(logs.every(log=>['fire_extinguishers','fire_inspection_history'].includes(log[1].table)));
    });
  }
});
test('invalid JSON, shape, range, truncated data, network errors are not success',async t=>{
  for (const make of [()=>new Response('{broken'),()=>reply({invalid:true},0),()=>new Response('[]'),
    ()=>reply([],1),()=>reply([],50001),()=>{throw new Error('sensitive remote failure');}]) {
    await t.test('invalid response',async t=>{
      t.mock.method(console,'error',()=>{});t.mock.method(globalThis,'fetch',async()=>make());
      const res=await request();assert.equal(res.status,502);assert.ok(!(await res.text()).includes('sensitive'));
    });
  }
});
test('redirects are rejected without forwarding credentials to another origin',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).origin,'https://fire.example');
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://other.example'}});
  });
  const response=await request();assert.equal(response.status,502);
  assert.ok(logs.some(log=>log[1].kind==='unexpected_redirect'));
  assert.ok(!(await response.text()).includes('other.example'));
});
test('upstream request timeout is enforced',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true})));
  const pending=request();t.mock.timers.tick(12000);
  assert.equal((await pending).status,504);
});
test('CORS preflight preserves fixed origin with no wildcard',async()=>{
  const res=await request('',{},'OPTIONS');assert.equal(res.status,204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
});
