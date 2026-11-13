/* The hosted app: nothing is reachable without signing in, and signing in works.
 *
 * Needs a server on APP_URL with a database and an allowlist — tests/run-hosted.mjs
 * sets that up. Sign-in links are read from the server log, which is where they go when
 * no RESEND_API_KEY is configured, so no email is ever sent by the tests. */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const APP = process.env.APP_URL ?? 'http://localhost:3310';
const LOG = process.env.SERVER_LOG;
const ALLOWED = process.env.TEST_ALLOWED_EMAIL ?? 'staff@example.org';
const t = (l, v, x = '') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);

const b = await puppeteer.launch({ headless: true });

/** Asks for a link as `email` and returns it, or undefined if none was issued. */
async function requestLink(page, email) {
  const before = fs.readFileSync(LOG, 'utf8').length;
  await page.goto(`${APP}/signin`, { waitUntil: 'domcontentloaded' });
  await page.type('#email', email);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const fresh = fs.readFileSync(LOG, 'utf8').slice(before);
  return (fresh.match(/http:\/\/\S*\/api\/auth\/callback\/resend\S+/) ?? [])[0];
}

console.log('\n=== nothing is reachable while signed out ===');
{
  const p = await b.newPage();
  for (const path of ['/', '/app', '/app/app.js', '/app/engine.js']) {
    const res = await p.goto(APP + path, { waitUntil: 'domcontentloaded' });
    t(`${path} sends you to sign in`, p.url().includes('/signin'), `${res.status()} ${p.url()}`);
  }
  // The report APIs must refuse with a status code, not an HTML login page.
  const codes = await p.evaluate(async (app) => {
    const out = {};
    for (const r of ['/api/llm', '/api/state', '/api/upload', '/api/generate']) {
      out[r] = await fetch(app + r, { method: 'POST', body: '{}' }).then((x) => x.status).catch(() => 0);
    }
    out['/api/pdf'] = await fetch(app + '/api/pdf', { method: 'POST', body: '{}' }).then((x) => x.status).catch(() => 0);
    return out;
  }, APP);
  for (const [route, code] of Object.entries(codes)) {
    t(`${route} refuses with 401`, code === 401, 'status ' + code);
  }
  t('the sign-in page itself is public', (await p.goto(APP + '/signin')).status() === 200);
  const health = await (await fetch(APP + '/api/health')).json();
  t('health check is public and green', health.ok === true, JSON.stringify(health).slice(0, 120));
  t('health reports the database', health.db === 'ok', String(health.db));
  await p.close();
}

console.log('\n=== an address that is not on the allowlist ===');
{
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  const link = await requestLink(p, 'stranger@example.com');
  t('no sign-in link is issued', !link, link ? 'ISSUED: ' + link.slice(0, 60) : '');
  t('but the page says the same thing either way', (await p.content()).includes('on its way'));
  await ctx.close();
}

console.log('\n=== an allowlisted member of staff ===');
let usedLink;
{
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  const link = await requestLink(p, ALLOWED);
  t('a sign-in link is issued', !!link);
  usedLink = link;
  // Without a link there is nothing to sign in with; say so once rather than throwing
  // an unrelated stack trace over the real failure.
  if (!link) {
    console.log('  (skipping the rest: no link to follow)');
    await ctx.close();
    await b.close();
    process.exit(1);
  }
  await p.goto(link, { waitUntil: 'domcontentloaded' });
  t('the link opens the app', p.url().includes('/app'), p.url());
  await p.waitForSelector('#sidebar', { timeout: 20000 });
  t('the app UI loads', true);
  const sess = await p.evaluate(() => fetch('/api/auth/session').then((r) => r.json()));
  t('the session names them', sess?.user?.email === ALLOWED);
  t('they belong to an organisation', !!sess?.user?.organisationId);
  t('their role defaults to staff', sess?.user?.role === 'staff', String(sess?.user?.role));
  t('the APIs answer now', (await p.evaluate(() => fetch('/api/llm').then((r) => r.status))) !== 401);

  const csrf = await p.evaluate(() => fetch('/api/auth/csrf').then((r) => r.json()));
  await p.evaluate((token) => fetch('/api/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: token, callbackUrl: '/' }),
  }), csrf.csrfToken);
  await p.goto(APP + '/app', { waitUntil: 'domcontentloaded' });
  t('signing out shuts the door again', p.url().includes('/signin'), p.url());
  await ctx.close();
}

console.log('\n=== a sign-in link is single use ===');
if (usedLink) {
  // A separate browser profile: no cookies, so this tests the token, not the session.
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.goto(usedLink, { waitUntil: 'domcontentloaded' });
  t('a spent link is refused', !p.url().includes('/app'), p.url());
  const sess = await p.evaluate(() => fetch('/api/auth/session').then((r) => r.json()).catch(() => ({})));
  t('and creates no session', !sess?.user);
  await p.goto(usedLink.replace(/token=([0-9a-f]{8})/, 'token=deadbeef'), { waitUntil: 'domcontentloaded' });
  t('a tampered token is refused', !p.url().includes('/app'), p.url());
  await ctx.close();
}

console.log('\n=== redirects cannot be steered by a spoofed header ===');
{
  // APP_URL is the canonical public address in production, so it wins over anything a
  // client claims. Otherwise a forged X-Forwarded-Host could send staff — and their
  // sign-in attempt — to someone else's domain.
  const res = await fetch(APP + '/app', {
    redirect: 'manual',
    headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
  });
  const loc = res.headers.get('location') ?? '';
  t('a forged forwarded host is ignored', !loc.includes('evil.example'), loc);
  t('the redirect uses the configured address', loc.startsWith(APP + '/signin'), loc);
}

console.log('\n=== the local bypass cannot open a hosted deployment ===');
{
  // AUTH_DISABLED is off for this server, but the shape of the check matters: a request
  // that arrives with a real client address must never be treated as local.
  const res = await fetch(APP + '/api/state', {
    method: 'PUT',
    headers: { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Host': 'smk-reports.fly.dev' },
  });
  t('a remote-looking request is still refused', res.status === 401, 'status ' + res.status);
}

await b.close();
