import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { buildSupplement } from '../scripts/prepare-migration.mjs';
import {calendarBackup, planCalendarImport} from '../calendar-data.mjs';

const asDraft = (id, extra = {}) => ({ id, startDate:'2026-09-16', endDate:'2026-09-17',
  yard:'HHI', hullNo:'HN-1', asType:'누설', asDetail:'작업 상세', workerInfo:'출장자',
  carInfo:'96오 7790', memo:"'); DELETE FROM issues; --", createdById:'owner', createdByName:'등록자', ...extra });
const teamDraft = (id, extra = {}) => ({ id, startDate:'2026-09-16', endDate:'2026-09-16',
  startTime:'09:00', endTime:'18:00', teamType:'회사행사', title:'회의', members:'팀원',
  location:'회의실', detail:'상세', createdById:'owner', createdByName:'등록자', ...extra });
const calendarSchema = readFileSync(new URL('../migrations/0003_shared_calendars.sql', import.meta.url), 'utf8');

function backup(as=[],team=[]){return calendarBackup({as,team});}
async function importBackup(env,data,mode='preview'){return request(env,'/api/calendars/import?mode='+mode,'POST',data);}
test('calendar backup preview is read-only, insert is idempotent and export preserves fields/timestamps',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);
  const data=backup([asDraft('as-one',{createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-02-01T00:00:00Z'})],[teamDraft('team-one')]);
  const preview=await (await importBackup(env,data)).json();
  assert.deepEqual(preview.report.as.newIds,['as-one']);assert.deepEqual(preview.report.team.newIds,['team-one']);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM as_events').get().n,0);
  const applied=await (await importBackup(env,data,'apply')).json();
  assert.deepEqual(applied.report.as.insertedIds,['as-one']);assert.deepEqual(applied.report.team.insertedIds,['team-one']);
  const retry=await (await importBackup(env,data,'apply')).json();
  assert.deepEqual(retry.report.as.insertedIds,[]);assert.deepEqual(retry.report.as.duplicateIds,['as-one']);
  const exported=(await (await request(env,'/api/calendars/export')).json()).backup;
  assert.deepEqual(Object.keys(exported),['app','version','exportedAt','asEvents','teamEvents']);
  assert.equal(exported.app,'AS출장_팀캘린더');assert.equal(exported.version,1);
  assert.equal(exported.asEvents[0].updatedAt,'2026-02-01T00:00:00.000Z');
  const reimport=await (await importBackup(env,exported)).json();assert.equal(reimport.report.as.conflicts.length,0);
});
test('calendar import preserves conflicts and D1-only rows while inserting other new IDs',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);
  await request(env,'/api/as-events/conflict','PUT',asDraft('conflict',{memo:'existing'}));
  await request(env,'/api/team-events/only-db','PUT',teamDraft('only-db'));
  const old=(await (await request(env,'/api/as-events')).json()).events;
  const result=await (await importBackup(env,backup([asDraft('conflict',{memo:'incoming'}),asDraft('new')]),'apply')).json();
  assert.deepEqual(result.report.as.insertedIds,['new']);assert.deepEqual(result.report.as.conflicts[0].fields,['memo']);
  assert.deepEqual((await (await request(env,'/api/as-events')).json()).events.find(row=>row.id==='conflict'),old[0]);
  assert.equal((await (await request(env,'/api/team-events')).json()).events.length,1);
});
test('calendar import handles legacy fields and rejects invalid input before any write',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);
  const legacy={id:'legacy',date:'2026-09-01',yard:'HHI',asType:'누설',carInfo:'96오 7790',workDetail:'legacy detail'};
  assert.equal((await importBackup(env,backup([legacy]),'apply')).status,200);
  const row=(await (await request(env,'/api/as-events')).json()).events[0];
  assert.equal(row.startDate,'2026-09-01');assert.equal(row.endDate,row.startDate);assert.equal(row.asDetail,'legacy detail');
  for(const data of [null,{},backup([asDraft('new')],[teamDraft('bad',{endTime:'01:00'})]),backup([asDraft('')]),backup([asDraft('bad',{createdAt:'bad'})]),{...backup(),version:2},backup(Array.from({length:501},()=>asDraft('limit')))]){
    assert.equal((await importBackup(env,data,'apply')).status,400);
  }
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM as_events').get().n,1);
});
test('duplicate IDs within a file: identical entries collapse, conflicting entries are all skipped',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);
  const data=backup([asDraft('same'),asDraft('same'),asDraft('ambiguous'),asDraft('ambiguous',{memo:'different'}),asDraft('new')]);
  const result=await (await importBackup(env,data,'apply')).json();
  assert.equal(result.report.as.fileDuplicates,1);assert.deepEqual(result.report.as.insertedIds,['same','new']);
  assert.equal(result.report.as.conflicts[0].reason,'file');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM as_events').get().n,2);
});
test('concurrent insert between preview and commit is never overwritten',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);const batch=env.DB.batch.bind(env.DB);
  env.DB.batch=async statements=>{
    await request(env,'/api/as-events/race','PUT',asDraft('race',{memo:'other PC'}));
    return batch(statements);
  };
  const result=await (await importBackup(env,backup([asDraft('race')]),'apply')).json();
  assert.deepEqual(result.report.as.insertedIds,[]);assert.equal(result.report.as.conflicts[0].id,'race');
  assert.equal(env.sqlite.prepare('SELECT memo FROM as_events WHERE id=?').get('race').memo,'other PC');
});
test('calendar batch failure rolls back both tables; database errors stay generic',async()=>{
  const env=makeEnv();env.sqlite.exec(calendarSchema);const prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.startsWith('INSERT INTO team_events'))statement.bind=(...args)=>({...statement,args,run:async()=>{throw new Error('PRIVATE SQL');}});
    return statement;
  };
  const response=await importBackup(env,backup([asDraft('one')],[teamDraft('two')]),'apply');
  assert.equal(response.status,500);assert.ok(!(await response.text()).includes('PRIVATE'));
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM as_events').get().n,0);
  env.DB.prepare=()=>{throw new Error('PRIVATE SQL');};
  const failed=await importBackup(env,backup());assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('PRIVATE'));
});
test('calendar backup shares CORS and binding checks; missing timestamps do not cause false conflicts',async()=>{
  assert.equal((await importBackup({},backup())).status,503);
  assert.equal((await request({},'/api/calendars/export')).status,503);
  const env=makeEnv();env.sqlite.exec(calendarSchema);
  const denied=await request(env,'/api/calendars/import','POST',backup(),{Origin:'https://evil.example'});assert.equal(denied.status,403);
  assert.equal((await request(env,'/api/calendars/import','OPTIONS')).status,204);
  assert.equal((await importBackup(env,backup(),'invalid')).status,400);
  const current=asDraft('same',{createdAt:'2020-01-01T00:00:00Z',updatedAt:'2020-02-01T00:00:00Z'});
  assert.deepEqual(planCalendarImport(backup([asDraft('same')]),{as:[current],team:[]}).report.as.duplicateIds,['same']);
});

for (const [collection, table, draftEvent] of [['as-events','as_events',asDraft], ['team-events','team_events',teamDraft]]) {
  test(collection + ': legacy migration retries preserve newer shared data', async () => {
    const env = makeEnv(); env.sqlite.exec(calendarSchema);
    const path = '/api/' + collection + '/legacy';
    const draft = draftEvent('legacy');
    const first = await request(env, path + '?migration=1', 'PUT', draft);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).event.id, 'legacy');
    const updated = await request(env, path, 'PUT', draftEvent('legacy',
      collection === 'as-events' ? {memo:'newer shared value'} : {title:'newer shared value'}));
    const latest = (await updated.json()).event;
    for (let retry = 0; retry < 2; retry++) {
      const imported = await request(env, path + '?migration=1', 'PUT', draft);
      assert.equal(imported.status, 200);
      assert.deepEqual((await imported.json()).event, latest);
    }
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 1);
  });

  test(collection + ': list, bound UPSERT, creation preservation and idempotent scoped delete', async () => {
    const env = makeEnv(); env.sqlite.exec(calendarSchema);
    await put(env, 'unchanged');
    const oldIssue = {...env.sqlite.prepare('SELECT * FROM issues').get()};
    const createdAt = '2020-01-01T00:00:00.000Z';
    const input = draftEvent('shared', {createdAt});
    const saved = await request(env, '/api/' + collection + '/shared', 'PUT', input);
    assert.equal(saved.status, 200);
    const event = (await saved.json()).event;
    for (const [key,value] of Object.entries(input)) assert.equal(event[key],value);
    const updated = await request(env, '/api/' + collection + '/shared', 'PUT', draftEvent('shared', {
      createdAt:'2025-01-01T00:00:00.000Z', createdById:'other', createdByName:'other',
      ...(collection === 'as-events' ? { memo:'수정' } : { title:'수정' }),
    }));
    assert.equal(updated.status,200);
    const changed = (await updated.json()).event;
    assert.equal(changed.createdAt,createdAt); assert.equal(changed.createdById,'owner');
    assert.equal(changed.createdByName,'등록자'); assert.ok(changed.updatedAt);
    await request(env,'/api/' + collection + '/earlier','PUT',draftEvent('earlier',{startDate:'2026-09-01',endDate:'2026-09-01'}));
    const list = await (await request(env,'/api/' + collection)).json();
    assert.deepEqual(list.events.map(e=>e.id),['earlier','shared']);
    assert.equal((await request(env,'/api/' + collection + '/shared','DELETE')).status,200);
    const again = await (await request(env,'/api/' + collection + '/shared','DELETE')).json();
    assert.equal(again.ok,true); assert.equal(again.deleted,false);
    assert.deepEqual({...env.sqlite.prepare('SELECT * FROM issues').get()},oldIssue);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n,1);
  });

  test(collection + ': invalid input, D1 error and CORS; PHOTOS binding is unnecessary', async () => {
    const env = makeEnv(); env.sqlite.exec(calendarSchema); delete env.PHOTOS;
    const invalid = [null, [], {}, draftEvent('wrong'), draftEvent('one',{startDate:'2026-02-30'}),
      draftEvent('one',{endDate:'2020-01-01'}), draftEvent('one',{createdAt:'bad'}),
      draftEvent('one',{createdByName:{bad:true}}),
      draftEvent('one',collection==='as-events'?{yard:''}:{title:''})];
    if (collection==='team-events') invalid.push(
      draftEvent('one',{startTime:'25:00'}), draftEvent('one',{endTime:'08:00'}), draftEvent('one',{endTime:''})
    );
    for (const input of invalid) assert.equal((await request(env,'/api/' + collection + '/one','PUT',input)).status,400);
    assert.equal((await request(env,'/api/' + collection + '/bad%20id','DELETE')).status,400);
    assert.equal((await request(env,'/api/' + collection + '/one','PUT',draftEvent('one'))).status,200);
    assert.equal((await request(env,'/api/' + collection + '/one','PUT',draftEvent('one'),{Origin:'https://evil.example'})).status,403);
    assert.equal((await request({},'/api/' + collection)).status,503);
    env.DB.prepare = () => { throw new Error('SENSITIVE SQL'); };
    const failed = await request(env,'/api/' + collection);
    assert.equal(failed.status,500); assert.ok(!(await failed.text()).includes('SENSITIVE'));
  });
}

test('calendar migration is repeatable, preserves issue records, and calendar IDs are independent', async () => {
  const env = makeEnv();
  await put(env,'keep');
  const before = {...env.sqlite.prepare('SELECT * FROM issues').get()};
  env.sqlite.exec(calendarSchema);
  assert.equal((await request(env,'/api/as-events/same','PUT',asDraft('same'))).status,200);
  assert.equal((await request(env,'/api/team-events/same','PUT',teamDraft('same'))).status,200);
  env.sqlite.exec(calendarSchema);
  await request(env,'/api/as-events/same','DELETE');
  assert.equal((await (await request(env,'/api/team-events')).json()).events.length,1);
  assert.deepEqual({...env.sqlite.prepare('SELECT * FROM issues').get()},before);
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|REPLACE|ALTER)\b/i.test(calendarSchema));
});

const origin = 'https://hojezzang.github.io';
const base = 'https://hpmanagement-web.lotusland1995.workers.dev';
const schema = readFileSync(new URL('../migrations/0001_cloudflare_schema.sql', import.meta.url), 'utf8');
export function makeEnv(legacyPayload = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(legacyPayload ? schema.replace('  id TEXT PRIMARY KEY NOT NULL,', '  id TEXT PRIMARY KEY NOT NULL,\n  payload TEXT NOT NULL,') : schema);
  const objects = new Map();
  const env = {
    sqlite, objects,
    DB: {
      prepare(sql) {
        const statement = {
          args: [],
          bind(...args) { return { ...statement, args }; },
          async first() { return sqlite.prepare(sql).get(...this.args) || null; },
          async all() { return { results: sqlite.prepare(sql).all(...this.args), success: true }; },
          async run() { const result = sqlite.prepare(sql).run(...this.args); return { success: true, meta: { changes: Number(result.changes) } }; },
        };
        return statement;
      },
      async batch(statements) {
        sqlite.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    },
    PHOTOS: {
      async put(key, data, options = {}) { objects.set(key, { bytes: new Uint8Array(data), type: options.httpMetadata?.contentType }); },
      async head(key) { return objects.has(key) ? { key } : null; },
      async get(key) {
        const object = objects.get(key); if (!object) return null;
        return { body: object.bytes, httpEtag: '"test-etag"', writeHttpMetadata(headers) { headers.set('Content-Type', object.type); } };
      },
      async delete(key) { objects.delete(key); },
    },
  };
  return env;
}
async function request(env, path, method = 'GET', body, headers = {}) {
  const response = await worker.fetch(new Request(base + path, {
    method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), env);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  return response;
}
const draft = (id, extra = {}) => ({ id, title: '점검', reporter: '등록자', reporterId: 'owner', images: [], afterImages: [], history: [], ...extra });
async function put(env, id, extra = {}) { return request(env, '/api/issues/' + id, 'PUT', draft(id, extra)); }
async function upload(env, { type = 'image/png', bytes = new Uint8Array([137,80,78,71,13,10,26,10,0]), issueId = 'one', category = 'before' } = {}) {
  const form = new FormData(); form.append('file', new File([bytes], '../../untrusted.png', { type }));
  form.append('issueId', issueId); form.append('category', category);
  const response = await worker.fetch(new Request(base + '/api/photos', { method: 'POST', headers: { Origin: origin }, body: form }), env);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  return response;
}

test('health, preflight, missing bindings and unknown routes', async () => {
  const env = makeEnv();
  assert.deepEqual(await (await request(env, '/api/health')).json(), { ok: true, database: true, photos: true });
  assert.equal((await request({}, '/api/health')).status, 503);
  const preflight = await request(env, '/api/anything', 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, POST, PUT, DELETE, OPTIONS');
  assert.equal((await request(env, '/missing')).status, 404);
  assert.equal((await request({}, '/api/issues')).status, 503);
  assert.equal((await request(env, '/api/issues/x', 'PUT', draft('x'), { Origin: 'https://evil.example' })).status, 403);
});

test('UPSERT all fields, bound SQL, preserved creation and normalized reads', async () => {
  const env = makeEnv();
  const createdAt = '2020-01-01T00:00:00.000Z';
  const fields = { issueNo:'N1', occurDate:'2026-09-01', registerDate:'2026-09-02', product:'AHU',
    projectNo:"'); DELETE FROM issues; --", processPnd:'2026-09-20', deliveryDate:'2026-09-21', process:'조립1',
    issueType:'불량', description:'설명', finder:'발견자', responsibleDept:'생산', status:'조치중', priority:'높음',
    dueDate:'2026-09-22', feedbackOwner:'담당', causeFeedback:'원인', actionDetail:'조치', completedDate:'',
    verifier:'검증자', prevention:'예방', followupFlag:true, sample:true, createdAt,
    history:[{ at:createdAt, status:'접수', actor:'등록자', note:'등록' }] };
  assert.equal((await put(env, 'one', fields)).status, 200);
  const row = env.sqlite.prepare('SELECT * FROM issues WHERE id = ?').get('one');
  assert.equal(Object.keys(row).length, 32);
  assert.equal(row.reporter_id, 'owner'); assert.equal(row.followup_flag, 1); assert.equal(row.sample, 1);
  assert.equal(row.project_no, fields.projectNo); assert.equal(typeof row.history, 'string');
  assert.equal((await put(env, 'one', { ...fields, createdAt:'2030-01-01', title:'수정' })).status, 200);
  const list = await (await request(env, '/api/issues')).json();
  assert.equal(list.issues.length, 1);
  assert.equal(list.issues[0].createdAt, createdAt);
  assert.equal(list.issues[0].title, '수정'); assert.equal(list.issues[0].process, '조립');
  assert.equal(list.issues[0].sample, true);
  assert.equal(list.issues[0].history[0].actor, '등록자');
});

test('existing required payload column supports inserts and updates without changing its constraint', async () => {
  const env = makeEnv(true);
  assert.equal((await put(env, 'legacy', { createdAt: '2020-01-01T00:00:00.000Z' })).status, 200);
  assert.equal((await put(env, 'legacy', { title: 'updated' })).status, 200);
  const row = env.sqlite.prepare('SELECT * FROM issues WHERE id = ?').get('legacy');
  assert.equal(JSON.parse(row.payload).title, 'updated');
  assert.equal(row.created_at, '2020-01-01T00:00:00.000Z');
  assert.equal(env.sqlite.prepare('PRAGMA table_info(issues)').all().find(column => column.name === 'payload').notnull, 1);
});

test('old malformed JSON and booleans cannot break issue reads', async () => {
  const env = makeEnv();
  env.sqlite.exec("INSERT INTO issues(id,images,after_images,history,followup_flag) VALUES('old','{bad','null','[null,42,{}]','false')");
  const { issues } = await (await request(env, '/api/issues')).json();
  assert.deepEqual(issues[0].images, []); assert.deepEqual(issues[0].afterImages, []);
  assert.equal(issues[0].history.length, 1); assert.equal(issues[0].followupFlag, false);
});

test('reject bad bodies, IDs, base64 and absent R2 photos without changing D1', async () => {
  const env = makeEnv();
  for (const value of [null, [], {}, draft('other'), draft('one', { images:['data:image/png;base64,iVBORw=='] }),
    draft('one', { images:['issues/one/before/missing.png'] }), draft('one', { history:[null] })]) {
    assert.equal((await request(env, '/api/issues/one', 'PUT', value)).status, 400);
  }
  assert.equal((await request(env, '/api/issues/one', 'PUT', '{bad')).status, 400);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get().n, 0);
});

test('photo upload, metadata, ETag, read, validation and idempotent deletion', async () => {
  const env = makeEnv();
  const response = await upload(env); assert.equal(response.status, 201);
  const photo = await response.json();
  assert.match(photo.key, /^issues\/one\/before\/[a-f0-9-]+\.png$/);
  assert.equal(photo.url, base + '/api/photos/' + photo.key);
  assert.equal(photo.contentType, 'image/png');
  const read = await request(env, '/api/photos/' + photo.key);
  assert.equal(read.status, 200); assert.equal(read.headers.get('Content-Type'), 'image/png');
  assert.equal(read.headers.get('ETag'), '"test-etag"'); assert.match(read.headers.get('Cache-Control'), /private/);
  assert.equal((await request(env, '/api/photos/' + photo.key, 'GET', undefined, { 'If-None-Match':'"test-etag"' })).status, 304);
  assert.equal((await upload(env, { type:'image/jpeg' })).status, 400);
  assert.equal((await upload(env, { issueId:'../bad' })).status, 400);
  assert.equal((await upload(env, { category:'other' })).status, 400);
  assert.equal((await upload(env, { bytes:new Uint8Array(5 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await request(env, '/api/photos/issues/one/before/%2e%2e%2fprivate.png')).status, 400);
  assert.equal((await request(env, '/api/photos/' + photo.key, 'DELETE')).status, 200);
  assert.equal((await request(env, '/api/photos/' + photo.key, 'DELETE')).status, 200);
  assert.equal((await request(env, '/api/photos/' + photo.key)).status, 404);
});

test('shared photos survive edits and single/bulk deletes until last reference is gone', async () => {
  const env = makeEnv();
  const photo = await (await upload(env)).json();
  assert.equal((await put(env, 'one', { images:[photo.url] })).status, 200);
  assert.equal((await put(env, 'two', { afterImages:[photo.key] })).status, 200);
  assert.equal((await (await request(env, '/api/photos/' + photo.key, 'DELETE')).json()).deleted, false);
  assert.equal((await request(env, '/api/issues/one', 'DELETE')).status, 200);
  assert.ok(env.objects.has(photo.key));
  assert.equal((await put(env, 'three', { images:[photo.url] })).status, 200);
  assert.equal((await put(env, 'two', { afterImages:[] })).status, 200);
  assert.ok(env.objects.has(photo.key));
  assert.equal((await request(env, '/api/issues/bulk-delete', 'POST', { ids:['two','three'] })).status, 200);
  assert.ok(!env.objects.has(photo.key));
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get().n, 0);
  for (const body of [{ids:[]}, {ids:['../bad']}, {}, null]) assert.equal((await request(env, '/api/issues/bulk-delete', 'POST', body)).status, 400);
});

test('D1 failure keeps existing data/photos; R2 cleanup failure is reported without lying about D1 commit', async () => {
  const env = makeEnv();
  const photo = await (await upload(env)).json();
  await put(env, 'one', { images:[photo.url] });
  const batch = env.DB.batch;
  env.DB.batch = async () => { throw new Error('SECRET SQL'); };
  const failed = await request(env, '/api/issues/one', 'DELETE');
  assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes('SECRET'));
  assert.ok(env.objects.has(photo.key)); assert.ok(env.sqlite.prepare('SELECT id FROM issues').get());
  env.DB.batch = batch;
  env.PHOTOS.delete = async () => { throw new Error('R2 failure'); };
  const deleted = await (await request(env, '/api/issues/one', 'DELETE')).json();
  assert.equal(deleted.ok, true); assert.equal(deleted.photosCleaned, false);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get().n, 0);
});

test('schema creates safely and supplement adds only missing columns without losing rows', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE issues(id TEXT PRIMARY KEY, title TEXT); INSERT INTO issues VALUES('old','preserve');");
  sqlite.exec(schema); sqlite.exec(schema);
  const supplement = buildSupplement(sqlite.prepare('PRAGMA table_info(issues)').all());
  assert.equal(supplement.missing.length, 30);
  assert.ok(!supplement.sql.includes('ADD COLUMN title'));
  sqlite.exec(supplement.sql);
  assert.equal(sqlite.prepare('SELECT title FROM issues WHERE id=?').get('old').title, 'preserve');
  assert.equal(sqlite.prepare('PRAGMA table_info(issues)').all().length, 32);
  const next = buildSupplement(sqlite.prepare('PRAGMA table_info(issues)').all());
  assert.deepEqual(next.missing, []);
  sqlite.exec(next.sql);
  assert.throws(() => buildSupplement([{ name:'title' }]), /no id/);
});
