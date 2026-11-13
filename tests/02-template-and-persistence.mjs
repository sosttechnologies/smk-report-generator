/* find the 404 and test template editing + persistence. */
import puppeteer from 'puppeteer';
import { loadSampleSingle } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const bad = [], errs = [];
p.on('requestfailed', (r) => bad.push(r.url() + ' :: ' + r.failure()?.errorText));
p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
console.log('--- failing requests ---');
console.log(bad.length ? bad.join('\n') : '(none)');

const t = (l, v) => console.log(`${v ? '✓' : '✗'} ${l}`);

// generate a report first
await loadSampleSingle(p);
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
const basePages = await p.$$eval('#docscroll .sheet', (n) => n.length);

// ---- template editor ----
await p.evaluate(() => document.querySelector('#nav-tpl').click());
await p.waitForSelector('.tpl-wrap');
t('template editor renders', true);
const rows = await p.$$eval('.srow2', (n) => n.length);
t(`section rows: ${rows} (expect 10)`, rows === 10);
const minis = await p.$$eval('.mini', (n) => n.length);
t(`page preview tiles: ${minis}`, minis >= 5);

// toggle a section off
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.srow2')];
  const sensory = rows.find((r) => r.textContent.includes('SENSORY'));
  sensory.querySelector('.toggle').click();
});
await new Promise((r) => setTimeout(r, 200));
const offState = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).template.sections.find((s) => s.id === 'sensory').on);
t('toggling a section off persists', offState === false);

// add a section
await p.evaluate(() => [...document.querySelectorAll('.btn-2')].find((b) => b.textContent.includes('Add section')).click());
await new Promise((r) => setTimeout(r, 200));
const rows2 = await p.$$eval('.srow2', (n) => n.length);
t(`add section works (${rows2})`, rows2 === 11);

// reorder with the arrow
const beforeOrder = await p.$$eval('.srow2 .lb', (n) => n.map((x) => x.textContent));
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.srow2')];
  const r = rows[4];
  [...r.querySelectorAll('button')].find((b) => b.textContent === '▲')?.click();
});
await new Promise((r) => setTimeout(r, 250));
const afterOrder = await p.$$eval('.srow2 .lb', (n) => n.map((x) => x.textContent));
t('reorder changes order', beforeOrder[3] !== afterOrder[3] || beforeOrder[4] !== afterOrder[4]);

// back to report — document should reflect template changes
await p.evaluate(() => [...document.querySelectorAll('.top-actions button')].find((b) => b.textContent.includes('Back to report')).click());
await p.waitForSelector('#docscroll .sheet');
const labels = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent));
t('disabled section removed from document', !labels.join(' ').includes('SENSORY'));
t('new section appears in document', labels.join(' ').includes('NEW SECTION'));

// ---- persistence across reload ----
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForSelector('#docscroll .sheet', { timeout: 10000 });
t('report survives reload', true);
const recents = await p.$$eval('#recents .side-item', (n) => n.length);
t(`recents shows ${recents} report`, recents === 1);
const labels2 = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent));
t('template changes survive reload', labels2.join(' ').includes('NEW SECTION'));

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.join('\n'));
await b.close();
