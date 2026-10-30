import { expect, it } from 'vitest';
import { createApp } from './app.js';
import { createPgliteDb } from './pglite.js';
import { hashPassword } from './auth.js';

it('limits password-change guesses without locking normal business requests or login', async () => {
  const db = await createPgliteDb();
  try {
    const passwordHash = await hashPassword('correct-password');
    const app = createApp({ getDb: async () => db, getConfig: () => ({ passwordHash, secureCookie: true }), getClientIp: () => '127.0.0.1' });
    const post = (path: string, body: unknown, cookie = '') => app.request(`http://localhost/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie }, body: JSON.stringify(body),
    });
    const login = await post('/auth/login', { username: 'admin', password: 'correct-password' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    for (let n = 0; n < 5; n++) {
      const res = await post('/auth/password', { currentPassword: 'wrong', newPassword: 'another-password' }, cookie);
      expect(res.status).toBe(n === 4 ? 429 : 401);
    }
    expect((await post('/auth/password', { currentPassword: 'correct-password', newPassword: 'another-password' }, cookie)).status).toBe(429);
    expect((await app.request('http://localhost/api/ideas', { headers: { cookie } })).status).toBe(200);
    expect((await post('/auth/login', { username: 'admin', password: 'correct-password' })).status).toBe(200);
  } finally { await db.close(); }
});
