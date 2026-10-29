// Prints a PASSWORD_HASH for the given password. Usage: npm run hash-password
// Reads from stdin without echo so the password never lands in shell history.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashPassword } from '../src/server/auth';

const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
process.stdout.write('输入新密码（至少 12 位）：');
rl.question('', async (password) => {
  rl.close();
  process.stdout.write('\n');
  if (password.length < 12) {
    console.error('密码太短，至少 12 位');
    process.exit(1);
  }
  console.log(await hashPassword(password));
});
