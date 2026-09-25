// Read-only by default. --write tests only newly generated smoke-test IDs.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const base = 'https://hpmanagement-web.lotusland1995.workers.dev';
const origin = 'https://hojezzang.github.io';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { Origin: origin, ...(body ? {'Content-Type':'application/json'} : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.headers.get('access-control-allow-origin'), origin, path + ' CORS');
  assert.equal(response.status, 200, method + ' ' + path);
  const result = await response.json();
  assert.equal(result.ok, true, path);
  return result;
}
const collections = ['as-events', 'team-events', 'issues'];
async function snapshot() {
  const rows = {};
  for (const collection of collections) {
    const data = await request('/api/' + collection);
    rows[collection] = (data.events || data.issues).sort((a, b) => a.id.localeCompare(b.id));
  }
  return rows;
}
assert.equal((await request('/api/health')).database, true);
const before = await snapshot();
const exported = (await request('/api/calendars/export')).backup;
assert.equal(exported.app, 'AS출장_팀캘린더');
assert.equal(exported.version, 1);
assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
assert.deepEqual([...exported.asEvents].sort((a,b)=>a.id.localeCompare(b.id)), before['as-events']);
assert.deepEqual([...exported.teamEvents].sort((a,b)=>a.id.localeCompare(b.id)), before['team-events']);
const preview = await request('/api/calendars/import?mode=preview', 'POST', exported);
assert.equal(preview.dryRun, true);
for (const [type,key] of [['as','as-events'],['team','team-events']]) {
  assert.equal(preview.report[type].newIds.length, 0);
  assert.equal(preview.report[type].conflicts.length, 0);
  assert.equal(preview.report[type].duplicateIds.length, before[key].length);
}
console.log('PASS remote JSON export format, all stored fields and duplicate-only dry-run');
for (const collection of collections) {
  console.log(JSON.stringify({collection, status:200, count:before[collection].length,
    sha256:createHash('sha256').update(JSON.stringify(before[collection])).digest('hex')}));
}
for (const collection of collections.slice(0, 2)) {
  const response = await fetch(base + '/api/' + collection + '/preflight', {
    method:'OPTIONS', headers:{Origin:origin, 'Access-Control-Request-Method':'PUT',
      'Access-Control-Request-Headers':'Content-Type'}, signal:AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
}
if (process.argv.includes('--write')) {
  for (const collection of collections.slice(0, 2)) {
    const id = 'calendar-smoke-' + randomUUID();
    assert.ok(!before[collection].some(event => event.id === id));
    const path = '/api/' + collection + '/' + id;
    const draft = {id, startDate:'2026-09-17', endDate:'2026-09-17',
      createdById:'migration-smoke', createdByName:'배포 검증',
      ...(collection === 'as-events'
        ? {yard:'TEST',asType:'배포 검증',carInfo:'TEST',memo:'temporary smoke test'}
        : {teamType:'회사행사',title:'temporary smoke test',startTime:'09:00',endTime:'10:00'})};
    try {
      const inserted = (await request(path + '?migration=1', 'PUT', draft)).event;
      assert.equal(inserted.id, id);
      const field = collection === 'as-events' ? 'memo' : 'title';
      const updated = (await request(path, 'PUT', {...draft, [field]:'updated smoke test'})).event;
      assert.equal(updated[field], 'updated smoke test');
      assert.equal(updated.createdAt, inserted.createdAt);
      const retried = (await request(path + '?migration=1', 'PUT', draft)).event;
      assert.deepEqual(retried, updated, 'Migration must preserve the newer D1 event');
      const events = (await request('/api/' + collection)).events;
      assert.deepEqual(events.find(event => event.id === id), updated);
    } finally {
      await request(path, 'DELETE');
    }
    assert.equal((await request(path, 'DELETE')).deleted, false);
    console.log('PASS remote CRUD and migration retry: ' + collection + '; test ID removed: ' + id);
  }
  assert.deepEqual(await snapshot(), before, 'Existing records must remain unchanged');
  console.log('PASS existing issues and calendar records unchanged');
}
console.log('PASS remote health, calendar/issues reads and calendar CORS preflights');
