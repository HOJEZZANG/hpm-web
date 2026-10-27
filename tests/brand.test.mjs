import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {koreanHistoryTime} from '../business/ui/issue-view.js';
import {externalServices} from '../business/ui/external-services.js';
test('provided company logo is byte-identical, relative and initialized theme precedes styles',()=>{
  assert.equal(createHash('sha256').update(readFileSync('assets/hi-air-korea-logo.png')).digest('hex'),'8a8e909a27c82530c3342b3d9eed7d9a87b8b4189bf5a39e4cff7300ea3dcc60');
  const html=readFileSync('index.html','utf8');assert(html.includes('src="assets/hi-air-korea-logo.png"'));assert(html.indexOf('src="business/ui/theme.js')<html.indexOf('<style>'));
  assert(!html.includes('id="suppliesPage"'));assert(!html.includes('id="mealsPage"'));
});
test('history displays verified instants in Korean time across date/year boundary and preserves ambiguous legacy values',()=>{
  assert.match(koreanHistoryTime('2026-12-31T23:30:00Z'),/2027\. 01\. 01\. 08:30.*한국 시간/);
  assert.equal(koreanHistoryTime('2026-12-31T23:30:00Z'),koreanHistoryTime('2027-01-01T08:30:00+09:00'));
  for(const value of ['2026-12-31','기존 미지정 시간','2026-10-20T12:30:00'])assert.equal(koreanHistoryTime(value),value);assert.equal(koreanHistoryTime(''),'—');
});
test('external destinations remain exactly user specified with a single configuration source',()=>{
  assert.equal(externalServices.supplies.url,'https://hiair-supplies.kwy1010.workers.dev/');assert.equal(externalServices.vehicles.url,'https://hiairkorea-truck.web.app/?utm_source=chatgpt.com');
  const nav=readFileSync('business/ui/navigation.js','utf8');assert(nav.includes('rel="noopener noreferrer"'));assert(nav.includes('target="_blank"'));assert(!nav.includes("item('식수"));
  const theme=readFileSync('business/ui/theme.js','utf8');assert(theme.includes("key='hpmTheme'"));assert(!/localStorage\.(?:clear|removeItem)/.test(theme));
});
