import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const baseline = process.argv[2];
if (!baseline) throw new Error('Usage: node scripts/compare-baseline.mjs <original-index.html>');
const original = readFileSync(baseline,'utf8').replaceAll('\r\n','\n');
const current = readFileSync(new URL('../index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const style = text => [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
assert.equal(style(current),style(original),'CSS changed');
function markup(text) {
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace('<div id="issueApiStatus" class="badge blue" role="status" aria-live="polite" hidden></div>','')
    .replaceAll('accept="image/jpeg,image/png,image/webp"','accept="image/*"')
    .replace(/\s+/g,' ').trim();
}
assert.equal(markup(current),markup(original),'Unexpected HTML markup change');
function between(text,a,b) {
  const start=text.indexOf(a),end=text.indexOf(b,start);
  assert.ok(start>=0&&end>=0,'Missing preservation anchor '+a);
  return text.slice(start,end).trim();
}
assert.equal(between(current,"    const AUTH_USERS_KEY","    const API_BASE_URL"),
  between(original,"    const AUTH_USERS_KEY","    const STORAGE_KEY"),'Account/profile code changed');
for (const [start,end] of [
  ['    function compressImage(', '    function applyPhotoZoom('],
  ['    function buildHistoryNote(', "    document.getElementById('issueForm')"],
  ['    function getFilteredIssues(', '    function toggleIssueSelection('],
  ['    function renderDashboard(', '    function encodeSnapshotBase64('],
  ["    const calendarState", 'async function initializePortal()'],
]) assert.equal(between(current,start,end),between(original,start,end),'Unexpected change: '+start);
console.log('PASS baseline diff: CSS and markup preserved except upload status/accept; accounts/profile, compression, history, filtering, dashboard/export, calendars unchanged.');
console.log('Original SHA256: '+createHash('sha256').update(readFileSync(baseline)).digest('hex'));
