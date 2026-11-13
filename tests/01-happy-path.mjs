/* the happy path — sample data → generate → review → export gate. */
import puppeteer from 'puppeteer';
import { loadSampleSingle } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });

const t = (label, v) => console.log(`${v ? '✓' : '✗'} ${label}`);

t('sidebar renders', await p.$('#sidebar') !== null);
t('upload screen is default', (await p.$eval('#screen', (n) => n.textContent)).includes("Drop in a student's forms"));
t('default project created', (await p.$$eval('#projects .side-item', (n) => n.length)) === 1);

// load the sample
await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'), { timeout: 15000 });
t('sample file row shows Read', true);
const meta = await p.$eval('.stu-meta', (n) => n.textContent);
t('student summary: ' + meta.trim(), meta.includes('3 subjects') && meta.includes('18 responses'));
t('student prefilled', (await p.$eval('.stu-name', (n) => n.value)) === 'Alex Sample');

const genDisabled = await p.$eval('.sticky-foot .btn', (n) => n.disabled);
t('Generate enabled once read', !genDisabled);

// generate (no sample capability in plain Chrome => template fallback path)
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
t('report screen rendered', true);

const pages = await p.$$eval('#docscroll .sheet', (n) => n.length);
t(`document has ${pages} pages (expect 6)`, pages === 6);
const footers = await p.$$eval('.dfoot', (n) => n.length);
t(`footer on every page (${footers})`, footers === pages);
const cols = await p.$$eval('.dtable th', (n) => n.length);
t(`subject table has ${cols} columns (expect 8)`, cols === 8);
const rows = await p.$$eval('.dtable tbody tr', (n) => n.length);
t(`subject table has ${rows} rows (expect 3)`, rows === 3);

// review gating
await p.evaluate(() => document.querySelector('.top-actions .btn').click());
await p.waitForSelector('.modal', { timeout: 5000 });
const tilesDisabled = await p.$$eval('.dl-tile', (n) => n.every((x) => x.disabled));
t('export disabled before review', tilesDisabled);
await p.keyboard.press('Escape');

// mark every section reviewed via the panel
const secCount = await p.$$eval('#panel .sec-row', (n) => n.length);
t(`panel lists ${secCount} sections (expect 9)`, secCount === 9);
for (let i = 0; i < secCount; i++) {
  await p.evaluate(() => {
    const back = [...document.querySelectorAll('#panel .btn-ghost')].find((b) => b.textContent.includes('All sections'));
    if (back) back.click();
  });
  await p.evaluate((idx) => document.querySelectorAll('#panel .sec-row')[idx].click(), i);
  await p.waitForFunction(() => document.querySelector('.panel-foot'), { timeout: 4000 });
  await p.evaluate(() => {
    const m = [...document.querySelectorAll('.panel-foot button')].find((b) => /Mark as reviewed/.test(b.textContent));
    if (m) m.click();
  });
}
const header = await p.$eval('.top-actions span', (n) => n.textContent);
t(`header says ${header.trim()}`, header.includes('9 of 9'));

await p.evaluate(() => document.querySelector('.top-actions .btn').click());
await p.waitForSelector('.modal', { timeout: 5000 });
const nowEnabled = await p.$$eval('.dl-tile', (n) => n.every((x) => !x.disabled));
t('export enabled after full review', nowEnabled);
await p.keyboard.press('Escape');

const real = errs.filter((e) => !e.includes('404'));
t('no console errors', real.length === 0);
if (real.length) console.log(real.slice(0, 6).join('\n'));
await p.screenshot({ path: '/tmp/shot-report.png' });
await b.close();
