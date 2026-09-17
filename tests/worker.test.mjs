import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { buildSupplement } from '../scripts/prepare-migration.mjs';

const asDraft = (id, extra = {}) => ({ id, startDate:'2026-09-16', endDate:'2026-09-17',
  yard:'HHI', hullNo:'HN-1', asType:'누설', asDetail:'작업 상세', workerInfo:'출장자',
  carInfo:'96오 7790', memo:"'); DELETE FROM issues; --", createdById:'owner', createdByName:'등록자', ...extra });
const teamDraft = (id, extra = {}) => ({ id, startDate:'2026-09-16', endDate:'2026-09-16',
  startTime:'09:00', endTime:'18:00', teamType:'회사행사', title:'회의', members:'팀원',
  location:'회의실', detail:'상세', createdById:'owner', createdByName:'등록자', ...extra });
const calendarSchema = readFileSync(new URL('../migrations/0003_shared_calendars.sql', import.meta.url), 'utf8');

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
