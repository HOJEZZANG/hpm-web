-- New server identities. Browser accounts/passwords are not imported.
CREATE TABLE portal_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('user','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','disabled')),
  profile TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile)), created_at TEXT NOT NULL
);
CREATE TABLE portal_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES portal_accounts(id), expires_at TEXT NOT NULL
);
CREATE INDEX portal_session_expiry ON portal_sessions(expires_at);
CREATE TABLE portal_auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL);
CREATE TABLE portal_bootstrap (id TEXT PRIMARY KEY CHECK(id='initial'));
-- Management-plane first-admin creation and its one-time guard are atomic.
CREATE TRIGGER portal_initial_admin_guard AFTER INSERT ON portal_accounts
WHEN NEW.role='admin' AND NEW.status='active'
BEGIN
  INSERT INTO portal_bootstrap(id) VALUES('initial') ON CONFLICT(id) DO NOTHING;
END;
