import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { buildSupplement } from '../scripts/prepare-migration.mjs';

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
