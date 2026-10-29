// Vercel build: apply Prisma migrations, then build the SPA.
//   production → migrate the production database
//   preview    → migrate the deployment's own Neon branch; refuse if it is the production database
//                (happens when Neon preview branching is off and the project-level DATABASE_URL leaks in)
//   other      → build only
import { execFileSync } from 'node:child_process';

const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: 'inherit' });

/** Neon endpoint id ("ep-xxx"), identical for pooled and direct hosts of the same branch. */
function neonEndpoint(url) {
  try {
    return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '');
  } catch {
    return null;
  }
}

const target = process.env.VERCEL_ENV;
const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (target === 'production' || target === 'preview') {
  if (!dbUrl) throw new Error(`[vercel-build] DATABASE_URL is missing for ${target}`);
  if (target === 'preview') {
    const prod = process.env.PRODUCTION_NEON_ENDPOINT;
    const current = neonEndpoint(dbUrl);
    if (!prod) throw new Error('[vercel-build] PRODUCTION_NEON_ENDPOINT is not set; refusing to migrate a preview database');
    if (current === prod) {
      throw new Error(
        '[vercel-build] This preview is connected to the PRODUCTION database. Enable Neon preview branching ' +
          '(Vercel → Storage → Neon → Connect Project → Create database branch for deployment → Preview).',
      );
    }
  }
  console.log(`[vercel-build] prisma migrate deploy (${target}, endpoint ${neonEndpoint(dbUrl)})`);
  run('npx', 'prisma', 'migrate', 'deploy');
} else {
  console.log(`[vercel-build] VERCEL_ENV=${target ?? 'unset'}: skipping migrations`);
}

run('npm', 'run', 'build');
