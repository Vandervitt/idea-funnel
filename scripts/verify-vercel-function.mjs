// Loads the Vercel function the way Vercel runs it: per-file compiled JS under plain Node ESM,
// then calls the health endpoint. Catches imports that only work under a bundler.
// Usage: npm run verify:vercel
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const outDir = process.argv[2];
const mod = await import(pathToFileURL(resolve(outDir, 'api/index.js')).href);
const res = await mod.GET(new Request('http://localhost/api/health'));
const body = await res.text();
if (res.status !== 200) {
  console.error(`health returned ${res.status}: ${body}`);
  process.exit(1);
}
console.log(`ok: /api/health → ${res.status} ${body}`);
