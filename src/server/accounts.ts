import type { Db } from './db.js';
import { SESSION_TTL_SECONDS } from './auth.js';

export interface Account {
  id: string;
  username: string;
  role: 'admin' | 'user';
}
export interface Credentials extends Account {
  password_hash: string;
  password_version: number;
}
const PUBLIC_COLUMNS = `id, username, role, created_at AS "createdAt"`;
const encode = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = async (token: string) => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));

export function createAccounts(db: Db) {
  return {
    async initializeAdmin(passwordHash: string) {
      // This is an initialization credential, never a password reset on subsequent deployments.
      await db.query(`INSERT INTO users (id, username, role, password_hash) VALUES ('me', 'admin', 'admin', $1)
        ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash WHERE users.password_hash IS NULL`, [passwordHash]);
    },
    async credentials(username: string): Promise<Credentials | undefined> {
      const [user] = await db.query<Credentials>(`SELECT id, username, role, password_hash, password_version FROM users WHERE username = $1`, [username]);
      return user;
    },
    async create(username: string, passwordHash: string) {
      const [user] = await db.query<Account & { createdAt: string }>(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING ${PUBLIC_COLUMNS}`,
        [username, passwordHash]);
      return user;
    },
    async list(cursor?: string) {
      const items = await db.query<Account & { createdAt: string }>(
        `SELECT ${PUBLIC_COLUMNS} FROM users ${cursor ? 'WHERE username > $1' : ''} ORDER BY username LIMIT 51`, cursor ? [cursor] : []);
      return { items: items.slice(0, 50), nextCursor: items.length > 50 ? items[49].username : null };
    },
    async openSession(user: Credentials): Promise<string | null> {
      const token = encode(crypto.getRandomValues(new Uint8Array(32)));
      // The row lock serializes with password changes; stale credentials cannot mint a new valid session.
      const rows = await db.query(`INSERT INTO sessions (token_hash, user_id, password_version, expires_at)
        SELECT $1, id, password_version, now() + make_interval(secs => $4)
        FROM (SELECT id, password_version FROM users WHERE id = $2 AND password_version = $3 FOR SHARE) u
        RETURNING token_hash`, [await digest(token), user.id, user.password_version, SESSION_TTL_SECONDS]);
      return rows.length ? token : null;
    },
    async authenticate(token?: string): Promise<Account | undefined> {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
      const [user] = await db.query<Account>(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND s.password_version = u.password_version`, [await digest(token)]);
      return user;
    },
    async closeSession(token?: string) {
      if (token && /^[a-f0-9]{64}$/.test(token)) await db.query('DELETE FROM sessions WHERE token_hash = $1', [await digest(token)]);
    },
    async changePassword(user: Credentials, passwordHash: string): Promise<boolean> {
      const [updated] = await db.transaction([
        { text: `UPDATE users SET password_hash = $3, password_version = password_version + 1
            WHERE id = $1 AND password_version = $2 RETURNING id`, params: [user.id, user.password_version, passwordHash] },
        { text: `DELETE FROM sessions s USING users u WHERE s.user_id = u.id AND u.id = $1 AND s.password_version <> u.password_version`, params: [user.id] },
      ]);
      return updated.length > 0;
    },
  };
}
