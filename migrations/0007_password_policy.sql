-- Existing accounts retain their password hashes, sessions and legacy password policy.
-- New member registrations explicitly select the numeric policy, independent of role.
ALTER TABLE portal_accounts ADD COLUMN password_policy TEXT NOT NULL DEFAULT 'legacy' CHECK(password_policy IN ('legacy','numeric'));
CREATE TRIGGER portal_password_policy_immutable BEFORE UPDATE OF password_policy ON portal_accounts
WHEN NEW.password_policy<>OLD.password_policy
BEGIN
  SELECT RAISE(ABORT,'PASSWORD_POLICY_IMMUTABLE');
END;
-- Only hashed account/IP keys and retry metadata; no credentials or password guesses.
CREATE TABLE portal_login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK(attempts>=1),
  window_start INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  nonce TEXT NOT NULL
);
