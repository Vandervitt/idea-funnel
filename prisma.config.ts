// Prisma is used for migrations only; queries stay as parameterized SQL in src/server/repo.ts.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations need a direct (non-pooled) connection; Neon's integration provides DATABASE_URL_UNPOOLED.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
