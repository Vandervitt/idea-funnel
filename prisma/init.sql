-- Run manually AFTER Prisma migrations in the intended database.
-- Initial login: admin / IdeaFunnel-Init-2026!
-- Change this temporary password from Settings after login.
-- Safe to repeat: an existing password, sessions and business data are preserved.
INSERT INTO users (id, username, role, password_hash)
VALUES (
  'me', 'admin', 'admin',
  'pbkdf2$100000$0CilNG+wXqKKBhC9iaGwEQ==$CzBg98Ave1QoohE/Lw5hhXRHWlk3CcxyeVXxnCEv8Aw='
)
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash
WHERE users.password_hash IS NULL;
