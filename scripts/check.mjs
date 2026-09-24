import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const [index, match] of scripts.entries()) {
  if (!/\bsrc=/.test(match[1])) new vm.Script(match[2], { filename: 'index-inline-' + index + '.js' });
}
const worker = spawnSync(process.execPath, ['--check', join(root, 'worker.js')], { encoding: 'utf8' });
assert.equal(worker.status, 0, worker.stderr);
const config = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
assert.equal(config.name, 'hpmanagement-web');
assert.equal(config.main, 'worker.js');
assert.equal(config.compatibility_date, '2026-09-15');
assert.equal(config.d1_databases[0].binding, 'DB');
assert.equal(config.d1_databases[0].database_name, 'hpmanagement-db');
assert.equal(config.d1_databases[0].database_id, '8f6f86d3-9a12-43ff-8236-8e2437ecc98e');
assert.deepEqual(config.r2_buckets, [{ binding: 'PHOTOS', bucket_name: 'hpm-photos' }]);
const removedProvider = 'supa' + 'base';
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.wrangler'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else {
      let content = readFileSync(path, 'utf8');
      assert.ok(!/sb_publishable_[A-Za-z0-9_-]{20,}/.test(content), 'Credential must not be stored: ' + path);
      if (path === join(root, 'worker.js')) content = content.replace(/\/\/ Read-only fire integration\.[\s\S]*?(?=async function route\()/, '');
      if (path === join(root, 'wrangler.jsonc')) {
        const checked = JSON.parse(content);
        assert.deepEqual(Object.keys(checked.vars || {}), ['FIRE_' + removedProvider.toUpperCase() + '_URL']);
        delete checked.vars;
        content = JSON.stringify(checked);
      }
      assert.ok(!content.toLowerCase().includes(removedProvider), 'Provider outside fire server integration: ' + path);
    }
  }
}
scan(root);
assert.equal((html.match(/const API_BASE_URL =/g) || []).length, 1);
assert.ok(!html.includes('saveIssues('));
assert.ok(!html.includes('processIssueFeedbackV1'));
assert.match(html, /await apiRequest\('\/api\/issues'\)/);
assert.match(html, /await saveIssue\(data\)/);
assert.match(html, /await apiRequest\('\/api\/issues\/bulk-delete'/);
for (const name of ['canDeleteIssue', 'compressImage', 'openPhotoLightbox', 'renderHistoryTimeline',
  'renderDashboard', 'renderStatistics', 'exportCsv', 'confirmPresentationExport', 'submitAuth',
  'savePortalUsers', 'saveCalendarEvents', 'renderMyPage', 'renderCalendar']) {
  assert.match(html, new RegExp('function ' + name + '\\('));
}
assert.match(html, /data-page="fireStatus"/);
assert.ok(!/<iframe\b/i.test(html));
console.log('PASS: Worker and ' + scripts.length + ' inline scripts parse; deployment config; provider limited to fire server; no keys; API wiring; preserved feature entry points.');
