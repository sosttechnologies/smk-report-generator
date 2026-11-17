/**
 * One Prisma client for the process, created on first use.
 *
 * Deliberately lazy. Secrets do not exist during a container build, so constructing the
 * client at module scope made `next build` fail with "Failed to collect page data for
 * /api/health" — Next imports every route to analyse it, and the import threw. Deferring
 * to first property access means a build needs no database, while a request still fails
 * loudly and early if the URL is genuinely missing.
 *
 * Next's dev server reloads modules on every edit; without the global cache that would
 * open a new connection pool on each save and exhaust Postgres within a few minutes.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Every route that stores anything depends on this. /api/health reports it rather
    // than failing a request with a stack trace.
    throw new Error('DATABASE_URL is not set — the hosted app cannot store anything.');
  }

  const created = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  globalForPrisma.prisma = created;
  return created;
}

/** Behaves exactly like a PrismaClient; builds one the first time it is touched. */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(client(), prop, receiver);
    return typeof value === 'function' ? value.bind(client()) : value;
  },
});
