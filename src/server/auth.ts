import type { Db } from './db';

// Workers caps PBKDF2 at 100k iterations; the hash records its own count so this can change later.
export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_COOKIE = 'if_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
// Single account: also cap failures across all IPs, so rotating addresses can't brute-force it.
export const MAX_GLOBAL_FAILURES = 30;
const GLOBAL_KEY = '*';

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}

/** Format: pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || !salt || !hash) return false;
  const actual = new Uint8Array(await pbkdf2(password, unb64(salt), iterations));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Token = "<expiry epoch seconds>.<HMAC of v1.expiry>" */
export async function signSession(secret: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`v1.${exp}`));
  return `${exp}.${b64url(sig)}`;
}

export async function verifySession(secret: string, token: string | undefined, now = Date.now()): Promise<boolean> {
  const m = token?.match(/^(\d{1,12})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 <= now) return false;
  const sig = unb64(m[2].replace(/-/g, '+').replace(/_/g, '/') + '=');
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig as BufferSource, enc.encode(`v1.${exp}`));
}

export function createLoginLimiter(db: Db) {
  /** Counts a failure for `key`; locks it once `max` is reached. Returns failures so far. */
  async function bump(key: string, max: number): Promise<number> {
    // An expired lock, or failures older than the lock window, start a fresh count.
    const [r] = await db.query<{ failures: number }>(
      `INSERT INTO login_attempts (ip, failures, updated_at) VALUES ($1, 1, now())
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN login_attempts.locked_until <= now()
                           OR (login_attempts.locked_until IS NULL
                               AND login_attempts.updated_at < now() - make_interval(mins => $2))
                         THEN 1 ELSE login_attempts.failures + 1 END,
         locked_until = CASE WHEN login_attempts.locked_until > now() THEN login_attempts.locked_until END,
         updated_at = now()
       RETURNING failures`,
      [key, LOCK_MINUTES],
    );
    if (r.failures >= max) {
      await db.query(`UPDATE login_attempts SET locked_until = now() + make_interval(mins => $2) WHERE ip = $1`, [
        key,
        LOCK_MINUTES,
      ]);
    }
    return r.failures;
  }

  return {
    async isLocked(ip: string): Promise<boolean> {
      const rows = await db.query(`SELECT 1 FROM login_attempts WHERE ip = ANY($1::text[]) AND locked_until > now()`, [
        [ip, GLOBAL_KEY],
      ]);
      return rows.length > 0;
    },
    /** Records a failure and returns attempts left before the lock (0 = now locked). */
    async recordFailure(ip: string): Promise<number> {
      const global = await bump(GLOBAL_KEY, MAX_GLOBAL_FAILURES);
      const own = await bump(ip, MAX_FAILURES);
      if (global >= MAX_GLOBAL_FAILURES) return 0;
      return Math.max(0, MAX_FAILURES - own);
    },
    async reset(ip: string): Promise<void> {
      await db.query(`DELETE FROM login_attempts WHERE ip = ANY($1::text[])`, [[ip, GLOBAL_KEY]]);
    },
  };
}
