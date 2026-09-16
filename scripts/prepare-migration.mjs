import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const schema = readFileSync(new URL('../migrations/0001_cloudflare_schema.sql', import.meta.url), 'utf8');
const columns = [...schema.matchAll(/^  ([a-z_]+) (TEXT|INTEGER)([^\n]*?)(?:,)?$/gm)].map(m => ({
  name: m[1], definition: `${m[1]} ${m[2]}${m[3]}`.replace(/,$/, ''),
}));

export function buildSupplement(existing) {
  if (!Array.isArray(existing) || !existing.length) throw new Error('Apply 0001 first, then inspect the existing issues table.');
  if (!existing.some(c => c.name === 'id')) throw new Error('Existing issues table has no id. Manual non-destructive reconciliation is required.');
  const names = new Set(existing.map(c => c.name));
  // Identifiers and definitions come only from the checked-in schema, never from user input.
  const missing = columns.filter(c => !names.has(c.name));
  const sql = missing.map(c => `ALTER TABLE issues ADD COLUMN ${c.definition};`);
  sql.push('CREATE UNIQUE INDEX IF NOT EXISTS hpm_issues_id_unique ON issues(id);');
  sql.push('CREATE INDEX IF NOT EXISTS hpm_issues_updated_at ON issues(updated_at);');
  return { missing: missing.map(c => c.name), sql: sql.join('\n') + '\n' };
}

function query(command, target) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['wrangler', 'd1', 'execute', 'hpmanagement-db', target, '--json', '--command', command];
  // Windows .cmd launch needs cmd.exe; SQL is fixed above, never interpolated from input.
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd wrangler d1 execute hpmanagement-db ' + target + ' --json --command="' + command + '"'], { cwd: root, encoding: 'utf8', windowsVerbatimArguments: true })
    : spawnSync(executable, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Schema inspection failed. Check Wrangler login and database access.\n' + (result.stderr || result.error?.message || ''));
  const response = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  if (!Array.isArray(response) || response.some(r => r.success === false)) throw new Error('Unexpected Wrangler response.');
  return response.flatMap(r => r.results || []);
}

function main() {
  const target = process.argv[2];
  if (!['--remote', '--local'].includes(target)) throw new Error('Usage: node scripts/prepare-migration.mjs --remote | --local');
  const existing = query('PRAGMA table_info(issues)', target);
  const result = buildSupplement(existing);
  const invalid = query("SELECT id FROM issues GROUP BY id HAVING COUNT(*) > 1 OR id IS NULL OR id = '' LIMIT 1", target);
  if (invalid.length) throw new Error('Duplicate or empty IDs found. No migration was written; resolve IDs without deleting data.');
  const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'", target);
  const applied = tables.length ? query("SELECT name FROM d1_migrations WHERE name = '0002_missing_issue_columns.sql'", target) : [];
  if (applied.length) {
    if (result.missing.length) throw new Error('0002 already applied but columns are missing. Create a new numbered migration; do not rewrite migration history.');
    console.log('0002 already applied; all required columns exist.'); return;
  }
  const output = new URL('../migrations/0002_missing_issue_columns.sql', import.meta.url);
  const old = readFileSync(output, 'utf8');
  if (!old.startsWith('-- GENERATED SCHEMA SUPPLEMENT:')) throw new Error('Refusing to overwrite a manually edited migration.');
  writeFileSync(output, '-- GENERATED SCHEMA SUPPLEMENT: inspected ' + target + '\n' + result.sql, 'utf8');
  console.log('Missing columns: ' + (result.missing.join(', ') || 'none'));
  console.log('Review migrations/0002_missing_issue_columns.sql, then run wrangler d1 migrations apply.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
