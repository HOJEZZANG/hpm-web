-- Keep immutable account IDs, ownership, passwords, roles and sessions intact.
-- Employee numbers are assigned only by registration or an explicit administrator action.
ALTER TABLE portal_accounts ADD COLUMN employee_no TEXT COLLATE NOCASE;
ALTER TABLE portal_accounts ADD COLUMN auth_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE portal_accounts ADD COLUMN production_verified_at TEXT;
ALTER TABLE portal_accounts ADD COLUMN production_verified_by TEXT;
CREATE UNIQUE INDEX portal_employee_no ON portal_accounts(employee_no COLLATE NOCASE) WHERE employee_no IS NOT NULL;

-- Prevent employee logins from shadowing another account's legacy login.
CREATE TRIGGER portal_employee_insert BEFORE INSERT ON portal_accounts
WHEN EXISTS (SELECT 1 FROM portal_accounts a WHERE
  (NEW.employee_no IS NOT NULL AND (a.employee_no=NEW.employee_no COLLATE NOCASE OR a.id=NEW.employee_no COLLATE NOCASE))
  OR a.employee_no=NEW.id COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT,'EMPLOYEE_LOGIN_CONFLICT');
END;
CREATE TRIGGER portal_employee_update BEFORE UPDATE OF employee_no ON portal_accounts
WHEN NEW.employee_no IS NOT NULL AND EXISTS (SELECT 1 FROM portal_accounts a WHERE a.id<>NEW.id
  AND (a.employee_no=NEW.employee_no COLLATE NOCASE OR a.id=NEW.employee_no COLLATE NOCASE))
BEGIN
  SELECT RAISE(ABORT,'EMPLOYEE_LOGIN_CONFLICT');
END;

-- Enforced inside SQLite so concurrent requests cannot remove the last administrator.
CREATE TRIGGER portal_last_admin_update BEFORE UPDATE OF role,status ON portal_accounts
WHEN OLD.role='admin' AND OLD.status='active' AND (NEW.role<>'admin' OR NEW.status<>'active')
  AND (SELECT count(*) FROM portal_accounts WHERE role='admin' AND status='active')<=1
BEGIN
  SELECT RAISE(ABORT,'LAST_ACTIVE_ADMIN');
END;
CREATE TRIGGER portal_last_admin_delete BEFORE DELETE ON portal_accounts
WHEN OLD.role='admin' AND OLD.status='active'
  AND (SELECT count(*) FROM portal_accounts WHERE role='admin' AND status='active')<=1
BEGIN
  SELECT RAISE(ABORT,'LAST_ACTIVE_ADMIN');
END;

CREATE TABLE portal_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  action TEXT NOT NULL, target_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  at TEXT NOT NULL
);
CREATE INDEX portal_audit_time ON portal_audit(at,id);
