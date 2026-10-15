import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
export const TOKEN="a".repeat(64);
const schema=readFileSync(new URL("../../migrations/0001_cloudflare_schema.sql",import.meta.url),"utf8");
export function makeEnv(legacyPayload = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(legacyPayload ? schema.replace('  id TEXT PRIMARY KEY NOT NULL,', '  id TEXT PRIMARY KEY NOT NULL,\n  payload TEXT NOT NULL,') : schema);
  sqlite.exec(readFileSync(new URL("../../migrations/0004_part1_business.sql",import.meta.url),"utf8"));
  sqlite.exec(readFileSync(new URL("../../migrations/0005_server_identity.sql",import.meta.url),"utf8"));
  sqlite.prepare("INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)").run("owner","등록자","synthetic","unused","admin","active",new Date().toISOString());
  sqlite.prepare("INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(TOKEN).digest("hex"),"owner","2099-01-01T00:00:00Z");
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
