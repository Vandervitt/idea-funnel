-- MANUAL RECOVERY ONLY. Verify the target database (e.g. preview) before running.
-- Resets existing admin to: IdeaFunnel-Init-2026!
-- Every execution revokes admin sessions; this is NOT an initialization/migration script.
-- Ordinary accounts and all ideas/tags/events are preserved.
DO $reset_admin$
BEGIN
  UPDATE users
  SET password_hash = 'pbkdf2$100000$0CilNG+wXqKKBhC9iaGwEQ==$CzBg98Ave1QoohE/Lw5hhXRHWlk3CcxyeVXxnCEv8Aw=',
      password_version = password_version + 1
  WHERE id = 'me' AND username = 'admin' AND role = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin does not exist; apply Prisma migrations and prisma/init.sql first';
  END IF;

  DELETE FROM sessions WHERE user_id = 'me';
  DELETE FROM login_attempts WHERE ip IN ('login:user:admin', 'password:user:admin');
END
$reset_admin$;
