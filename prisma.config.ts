/**
 * Prisma 7 keeps the connection URL out of the schema: migrations read it from here,
 * and the runtime client gets it through the pg adapter in src/lib/db.ts.
 *
 * DATABASE_URL is a secret. It lives in .env.local locally and in `fly secrets` in
 * production — never in the repository. Next.js loads .env.local itself; the Prisma CLI
 * does not, so it is loaded here explicitly. Read with a fallback rather than env(),
 * which throws and makes even `prisma --help` unusable on a fresh clone.
 */

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations need a DIRECT connection. Neon's DATABASE_URL is the pooled
    // (pgbouncer) endpoint, which cannot run the DDL a migration issues, so prefer the
    // unpooled one when it exists. The running app keeps using the pooled URL.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
