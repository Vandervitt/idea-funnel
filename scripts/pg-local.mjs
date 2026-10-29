// Local Postgres for Prisma CLI work (migrate dev / diff) without Docker or a cloud database:
// two in-memory PGlite instances served over the Postgres wire protocol.
//   app    → postgresql://postgres@127.0.0.1:54329/postgres?sslmode=disable
//   shadow → postgresql://postgres@127.0.0.1:54330/postgres?sslmode=disable
// Usage: npm run db:local   (Ctrl+C to stop; data is discarded)
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const servers = [];
for (const [name, port] of [['app', 54329], ['shadow', 54330]]) {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  servers.push([server, db]);
  console.log(`[pg-local] ${name}: postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
}

const stop = async () => {
  for (const [server, db] of servers) {
    await server.stop();
    await db.close();
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
