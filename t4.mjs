/* Scenario 4: editing, undo, delete/undo, projects, search, narrow layout, print. */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });

await p.evaluate(() => [...document.querySelectorAll('.pill')].find((x) => x.textContent.includes('George')).click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });

console.log('\n=== inline editing ===');
const before = await p.$eval('.dlabel', (n) => n.textContent);
await p.evaluate(() => {
  const n = document.querySelector('.dsec p');
  n.focus(); n.textContent = 'EDITED BY TEST';
  n.dispatchEvent(new Event('blur'));
});
await new Promise((r) => setTimeout(r, 200));
t('paragraph edit applied', (await p.$eval('.dsec p', (n) => n.textContent)) === 'EDITED BY TEST');
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].blocks.overview[0].text);
t('edit persisted to storage', stored === 'EDITED BY TEST');

console.log('\n=== section select + sources + undo ===');
await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[2].click());
await p.waitForFunction(() => document.querySelector('.panel-foot'));
const srcs = await p.$$eval('.src', (n) => n.length);
t(`source cards shown (${srcs})`, srcs > 0);
const meta = await p.$eval('.src .m', (n) => n.textContent);
t('source card cites the form question', /Q\d/.test(meta), meta);

await p.evaluate(() => document.querySelectorAll('#panel .sec-row, .panel-foot button')); // noop
await p.evaluate(() => {
  const back = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections'));
  back?.click();
});
await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[0].click());
await p.waitForFunction(() => document.querySelector('.panel-foot'));
await p.evaluate(() => {
  const n = document.querySelector('.dsec p');
  n.focus(); n.textContent = 'SECOND EDIT'; n.dispatchEvent(new Event('blur'));
});
await new Promise((r) => setTimeout(r, 250));
const hasUndo = await p.evaluate(() => [...document.querySelectorAll('#panel button')].some((x) => x.textContent === 'Undo'));
t('undo offered in the changes log', hasUndo);
if (hasUndo) {
  await p.evaluate(() => [...document.querySelectorAll('#panel button')].find((x) => x.textContent === 'Undo').click());
  await new Promise((r) => setTimeout(r, 250));
  t('undo restored previous text', (await p.$eval('.dsec p', (n) => n.textContent)) === 'EDITED BY TEST');
}

console.log('\n=== review flips status ===');
const secs = await p.$$eval('#panel .sec-row, .panel-foot', () => 0);
await p.evaluate(() => {
  const back = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections'));
  back?.click();
});
const n = await p.$$eval('#panel .sec-row', (x) => x.length);
for (let i = 0; i < n; i++) {
  await p.evaluate(() => { const b = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections')); b?.click(); });
  await p.evaluate((i) => document.querySelectorAll('#panel .sec-row')[i].click(), i);
  await p.waitForFunction(() => document.querySelector('.panel-foot'));
  await p.evaluate(() => [...document.querySelectorAll('.panel-foot button')].find((x) => /Mark as reviewed/.test(x.textContent))?.click());
}
const status = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].status);
t(`status became ${status}`, status === 'Ready');
const tags = await p.$$eval('.tag.rev', (x) => x.length);
t(`REVIEWED tags on the page (${tags})`, tags > 0);

console.log('\n=== projects, search, delete + undo ===');
await p.evaluate(() => document.querySelector('#new-proj').click());
await p.waitForFunction(() => document.querySelector('#screen input')?.value === 'Untitled project', { timeout: 8000 });
t('new project created and opened', true);
t('empty state shown', (await p.$eval('#screen', (x) => x.textContent)).includes('No reports here yet'));
const projCount = await p.$$eval('#projects .side-item', (x) => x.length);
t(`sidebar shows ${projCount} projects`, projCount === 2);

await p.evaluate(() => { document.querySelector('#search').value = 'zzz'; document.querySelector('#search').dispatchEvent(new Event('input')); });
t('search with no match shows message', (await p.$eval('#recents', (x) => x.textContent)).includes('No reports match'));
await p.evaluate(() => { document.querySelector('#search').value = 'george'; document.querySelector('#search').dispatchEvent(new Event('input')); });
t('search matches by student', (await p.$$eval('#recents .side-item', (x) => x.length)) === 1);
await p.evaluate(() => { document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input')); });

await p.evaluate(() => {
  const row = document.querySelector('#recents .side-item');
  row.querySelector('.dots').click();
});
await p.waitForSelector('.menu');
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find((x) => x.textContent === 'Delete').click());
await p.waitForSelector('.scrim');
t('delete asks for confirmation', true);
await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Delete').click());
await new Promise((r) => setTimeout(r, 300));
t('report deleted', (await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports.length)) === 0);
t('undo offered in toast', (await p.$eval('#toast', (x) => x.textContent)).includes('Undo'));
await p.evaluate(() => [...document.querySelectorAll('#toast button')].find((x) => x.textContent === 'Undo').click());
await new Promise((r) => setTimeout(r, 300));
t('undo restored the report', (await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports.length)) === 1);

console.log('\n=== narrow viewport ===');
await p.setViewport({ width: 420, height: 820 });
await new Promise((r) => setTimeout(r, 400));
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t(`no horizontal page overflow (${overflow}px)`, overflow <= 1);

console.log('\n=== print stylesheet ===');
await p.setViewport({ width: 1440, height: 900 });
await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('smk-report-generator-v1')); });
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForSelector('#docscroll .sheet');
await p.emulateMediaType('print');
const hidden = await p.evaluate(() => {
  const vis = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).display !== 'none' : false; };
  return { sidebar: vis('#sidebar'), topbar: vis('#topbar'), panel: vis('#panel'), sheet: vis('.sheet') };
});
t('print hides chrome, keeps the document', !hidden.sidebar && !hidden.topbar && !hidden.panel && hidden.sheet, JSON.stringify(hidden));
const pdf = await p.pdf({ format: 'A4', printBackground: true });
t(`PDF renders (${(pdf.length/1024).toFixed(0)} KB)`, pdf.length > 20000);
(await import('node:fs')).writeFileSync('/tmp/t4.pdf', pdf);

t('no page errors throughout', errs.length === 0);
if (errs.length) console.log(errs.slice(0,5).join('\n'));
await b.close();
