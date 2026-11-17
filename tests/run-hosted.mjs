/**
 * Runs the hosted-app suite: build, start a server with auth and a database, drive it.
 *
 *   npm run test:hosted
 *
 * Needs a Postgres in DATABASE_URL. Locally that is `npx prisma dev`, which needs no
 * Docker. Without one this exits 0 with a message rather than failing a run, because
 * `npm test` and `npm run test:web` deliberately have no database dependency.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3310;
const LOG = path.join(root, '.next', 'test-hosted-server.log');
const ALLOWED = 'staff@example.org';

// .env.local is where a developer's DATABASE_URL lives; Next loads it but this script
// does not, so read it the same way prisma.config.ts does.
for (const file of ['.env.local', '.env']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// This suite DELETES every session and verification token as part of its setup. Run it
// against production and everyone is signed out — so it refuses anything that is not
// plainly a local database, unless TEST_DATABASE_URL says otherwise on purpose.
const TEST_DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(TEST_DB ?? '');

if (!TEST_DB) {
  console.log('• skipped: no database. Start one with `npm run db`, then rerun.');
  process.exit(0);
}
if (!isLocal) {
  console.error('✗ refusing to run: DATABASE_URL is not a local database.');
  console.error('  This suite deletes all sessions and users — against production that');
  console.error('  signs out every member of staff.');
  console.error('');
  console.error('  Start a local one:   npm run db');
  console.error('  Then:                TEST_DATABASE_URL="postgres://…localhost…" npm run test:hosted');
  process.exit(1);
}
// Both, and set rather than deleted: prisma.config.ts loads .env.local itself, and
// dotenv fills in anything NOT already in the environment — so a deleted variable comes
// straight back pointing at production.
process.env.DATABASE_URL = TEST_DB;
process.env.DATABASE_URL_UNPOOLED = TEST_DB;

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed\n${out.slice(-1500)}`))));
  });
}

/** A leftover server from a crashed run would make every assertion meaningless. */
async function portFree(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return !res;
  } catch {
    return true;
  }
}

async function waitFor(url, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

if (!await portFree(PORT)) {
  console.error(`✗ something is already listening on ${PORT}. Stop it first:\n    lsof -ti:${PORT} | xargs kill`);
  process.exit(1);
}

console.log('applying migrations…');
await run('npx', ['prisma', 'migrate', 'deploy']);

// A clean slate, so "a link is issued" and "they belong to an organisation" mean what
// they say rather than inheriting a previous run's rows.
console.log('clearing test accounts…');
await run(process.execPath, ['-e', `
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  (async () => {
    await db.auditEvent.deleteMany({});
    await db.report.deleteMany({});   // or the app opens on an old report, not the upload screen
    await db.settings.deleteMany({});
    await db.session.deleteMany({});
    await db.verificationToken.deleteMany({});
    await db.user.deleteMany({ where: { email: { in: ['${ALLOWED}', 'stranger@example.com'] } } });
    await db.$disconnect();
  })();
`]);

console.log('building…');
await run('npm', ['run', 'build']);

fs.writeFileSync(LOG, '');
const logStream = fs.createWriteStream(LOG, { flags: 'a' });
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    AUTH_URL: `http://localhost:${PORT}`,
    APP_URL: `http://localhost:${PORT}`,
    AUTH_SECRET: process.env.AUTH_SECRET || 'test-secret-not-for-production',
    ALLOWED_EMAILS: ALLOWED,
    RESEND_API_KEY: '',        // links go to the log, so no email leaves the machine
    LLM_PROVIDER: 'none',      // and no model is called
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(logStream);
server.stderr.pipe(logStream);

try {
  if (!await waitFor(`http://localhost:${PORT}/api/health`)) {
    throw new Error(`server did not start\n${fs.readFileSync(LOG, 'utf8').slice(-1200)}`);
  }
  const suite = await new Promise((resolve) => {
    let out = '';
    const c = spawn(process.execPath, [path.join(root, 'tests', '21-hosted.mjs')], {
      cwd: root,
      env: { ...process.env, APP_URL: `http://localhost:${PORT}`, SERVER_LOG: LOG, TEST_ALLOWED_EMAIL: ALLOWED },
    });
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ out, code }));
  });

  const passed = (suite.out.match(/^✓/gm) ?? []).length;
  const failed = (suite.out.match(/^✗/gm) ?? []).length;
  console.log(suite.out);
  const ok = !failed && suite.code === 0;
  console.log(`${ok ? '✓' : '✗'} hosted app: ${passed} passed${failed ? `, ${failed} failed` : ''}${suite.code ? ` — CRASHED (exit ${suite.code})` : ''}`);
  process.exit(ok ? 0 : 1);
} finally {
  // SIGKILL, not SIGTERM: a Next server that lingers holds the port and makes the next
  // run fail with EADDRINUSE, which looks like a test failure but is not one.
  server.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
}
