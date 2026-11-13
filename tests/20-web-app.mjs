/* The self-hosted web app: UI served by Next.js, model and PDF through our own API.
   Expects the app on $APP_URL (default http://localhost:3000). */
import puppeteer from 'puppeteer';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 980 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const client = await p.createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/smk-dl' }).catch(() => {});

console.log(`\n=== ${APP} ===`);
const res = await p.goto(`${APP}/app`, { waitUntil: 'networkidle0' });
t(`UI served at /app (HTTP ${res.status()})`, res.status() === 200);
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
t('no claude runtime on the page', await p.evaluate(() => !window.claude));
t('app rendered anyway', await p.$('#sidebar') !== null);
const info = await (await fetch(`${APP}/api/llm`)).json();
t(`backend reports provider "${info.provider}"`, typeof info.available === 'boolean');

console.log('\n=== generate through our backend ===');
await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
for (;;) {
  const done = await p.evaluate(() => { const bx = [...document.querySelectorAll('.stu-row input[type=checkbox]')]; const x = bx.slice(1).find((c) => c.checked); if (!x) return true; x.click(); return false; });
  if (done) break; await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 200));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 90000 });
await new Promise((r) => setTimeout(r, 700));
const rep = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0]);
t('a report was produced', !!rep && Object.keys(rep.blocks).length >= 8);
if (info.available) {
  t('the MODEL wrote it (not the template)', rep.templated === false);
  t('model text reached the page', (await p.$eval('#docscroll', (n) => n.textContent)).includes('MOCK overview'));
} else {
  t('template path used (no provider configured)', rep.templated === true);
}

console.log('\n=== review every section, then export via the real download ===');
const n = await p.$$eval('#panel .sec-row', (x) => x.length);
for (let i = 0; i < n; i++) {
  await p.evaluate(() => { const bk = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections')); bk?.click(); });
  await p.evaluate((i) => document.querySelectorAll('#panel .sec-row')[i].click(), i);
  await p.waitForFunction(() => document.querySelector('.panel-foot'));
  await p.evaluate(() => [...document.querySelectorAll('.panel-foot button')].find((x) => /Mark as reviewed/.test(x.textContent))?.click());
}
await p.evaluate(() => document.querySelector('.top-actions .btn').click());
await p.waitForSelector('.modal');
const tiles = await p.$$eval('.dl-tile', (x) => x.map((n) => ({ label: n.querySelector('b').textContent, disabled: n.disabled })));
t('all four export actions enabled (downloads work here)', tiles.every((x) => !x.disabled), tiles.map((x) => `${x.label}:${x.disabled ? 'off' : 'on'}`).join(' '));

// Intercept the PDF request to prove the server rendered it
const pdfReq = p.waitForResponse((r) => r.url().endsWith('/api/pdf'), { timeout: 60000 });
await p.evaluate(() => [...document.querySelectorAll('.dl-tile')].find((x) => x.textContent.startsWith('Download PDF')).click());
const pdfRes = await pdfReq;
t(`server rendered the PDF (HTTP ${pdfRes.status()}, ${pdfRes.headers()['content-type']})`,
  pdfRes.status() === 200 && pdfRes.headers()['content-type'] === 'application/pdf');
// A response the browser hands to its download manager has no readable body
// here, so verify the bytes by asking the same route directly with the page's HTML.
const html = await p.evaluate(() => {
  const host = document.querySelector('#docscroll').cloneNode(true);
  host.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  return `<!doctype html><html><body>${host.innerHTML}</body></html>`;
});
const direct = await fetch(`${APP}/api/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html, filename: 'check.pdf' }) });
const buf = Buffer.from(await direct.arrayBuffer());
// Page objects are inside compressed streams, so counting them by regex undercounts;
// a six-page letterhead PDF is reliably well over 50 KB.
t(`PDF is real (${(buf.length / 1024).toFixed(0)} KB)`, buf.slice(0, 4).toString() === '%PDF' && buf.length > 50_000);

if (info.available) {
  console.log('\n=== refine box talks to the backend too ===');
  await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Close').click());
  await new Promise((r) => setTimeout(r, 200));
  await p.evaluate(() => { const bk = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections')); bk?.click(); });
  await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[0].click());
  await p.waitForFunction(() => document.querySelector('.chat-input'));
  t('rewrite is enabled', await p.$eval('.chat-send', (x) => !x.disabled));
  await p.type('.chat-input', 'make it warmer');
  await p.click('.chat-send');
  await p.waitForFunction(() => document.querySelector('#sec-overview')?.textContent.includes('MOCK rewritten'), { timeout: 30000 });
  t('section rewritten through /api/llm', true);
  t('rewrite cleared the reviewed tick', !(await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].reviewed.overview)));
}

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
