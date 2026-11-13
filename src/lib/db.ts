/**
 * One Prisma client for the process.
 *
 * Next's dev server reloads modules on every edit; without the global cache that would
 * open a new connection pool on each save and exhaust Postgres within a few minutes.
 *
 * Prisma 7 takes the connection through a driver adapter rather than from the schema,
 * so the URL is read here and nowhere else.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Loud, because every route that touches storage depends on it. The app's own
    // /api/health reports this rather than failing a request with a stack trace.
    throw new Error('DATABASE_URL is not set — the hosted app cannot store anything.');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db: PrismaClient = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
