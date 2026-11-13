import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 960, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
t('upload icon present', await p.$('.drop-ic') !== null);
t('headline is the standard wording', (await p.$eval('#drop p', (n) => n.textContent)).includes('Drag files here, or browse your computer'));
const fmts = await p.$$eval('.fmt', (n) => n.map((x) => x.textContent));
t('formats listed', fmts.join(' '), fmts.join(' '));
t('sample is a quiet secondary link', (await p.$eval('.try-line', (n) => n.textContent)).includes('No files to hand?'));
await p.screenshot({ path: '/tmp/shots/9-upload.png' });
// clicking the zone opens the picker; clicking the sample link must not also open it
const sampleWorks = await p.evaluate(async () => {
  document.querySelector('.linkish').click();
  await new Promise((r) => setTimeout(r, 400));
  return !!document.querySelector('.frow');
});
t('sample link still loads the demo data', sampleWorks);
t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.join('\n'));
await b.close();
