/* Clicking an uploaded file previews it; export offers page selection. */
import puppeteer from 'puppeteer';
import { loadSampleSingle, generate } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 980 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });

console.log('\n=== uploaded file is clickable and previews its contents ===');
await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await new Promise((r) => setTimeout(r, 300));
t('file row is marked clickable', await p.$('.frow.clickable') !== null);
t('no preview until clicked', (await p.$$eval('.fprev', (n) => n.length)) === 0);
await p.evaluate(() => document.querySelector('.frow.clickable').click());
await new Promise((r) => setTimeout(r, 250));
t('preview opens', await p.$('.fprev') !== null);
const students = await p.$$eval('.fprev-stu', (n) => n.map((x) => x.textContent));
t(`preview groups by student (${students.length})`, students.length === 3, students.join(', '));
const cards = await p.$$eval('.fprev-card', (n) => n.length);
t(`one card per response (${cards})`, cards === 30);
const meta = await p.$eval('.fprev-meta', (n) => n.textContent);
t('card shows subject, week, tutor, attendance', /w\/b/.test(meta) && /Tutor/.test(meta), meta);
t('ratings shown as chips', (await p.$$eval('.fprev-chip', (n) => n.length)) > 20);
t('tutor comments shown verbatim', (await p.$eval('.fprev', (n) => n.textContent)).includes('Strong participation and engagement'));
await p.evaluate(() => document.querySelector('.frow.clickable').click());
await new Promise((r) => setTimeout(r, 200));
t('clicking again closes it', (await p.$$eval('.fprev', (n) => n.length)) === 0);
t('the remove button still works without opening the preview', await p.evaluate(() => {
  const before = document.querySelectorAll('.frow').length;
  document.querySelector('.frow .xbtn').click();
  return document.querySelectorAll('.frow').length === before - 1;
}));

console.log('\n=== export: page selection ===');
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await loadSampleSingle(p);
await generate(p);
await p.evaluate(() => document.querySelector('.top-actions .btn').click());
await p.waitForSelector('.modal');
t('no "for the family" wording', !/for the family/i.test(await p.$eval('.modal', (n) => n.textContent)));
const pageRows = await p.$$eval('.pagepick-row', (n) => n.length);
t(`lists all ${pageRows} pages`, pageRows === 6);
const labels = await p.$$eval('.pagepick-row span:last-child', (n) => n.map((x) => x.textContent));
t('pages are named', labels[0] === 'Overview' && labels[1] === 'Subject table', labels.slice(0, 3).join(' | '));
const actions = await p.$$eval('.dl-tile b', (n) => n.map((x) => x.textContent));
t('offers print, Word, PDF and email', JSON.stringify(actions), actions.join(' / '));
t('all actions blocked before review', await p.$$eval('.dl-tile', (n) => n.every((x) => x.disabled)));
// runtime.js provides downloads in any browser now, so every tile unlocks once
// the report is reviewed. (Against this static server a PDF click would 404 at
// /api/pdf — that path is covered by run-web.mjs with the real backend.)

console.log('\n=== review, then the selection drives the output ===');
await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Close').click());
await new Promise((r) => setTimeout(r, 250));
const n = await p.$$eval('#panel .sec-row', (x) => x.length);
t(`panel lists ${n} sections to review`, n === 9);
for (let i = 0; i < n; i++) {
  await p.evaluate(() => { const bk = [...document.querySelectorAll('#panel .btn-ghost')].find((x) => x.textContent.includes('All sections')); bk?.click(); });
  await p.evaluate((i) => document.querySelectorAll('#panel .sec-row')[i].click(), i);
  await p.waitForFunction(() => document.querySelector('.panel-foot'));
  await p.evaluate(() => [...document.querySelectorAll('.panel-foot button')].find((x) => /Mark as reviewed/.test(x.textContent))?.click());
}
await p.evaluate(() => document.querySelector('.top-actions .btn').click());
await p.waitForSelector('.modal');
t('print and email unlock once reviewed', await p.$$eval('.dl-tile', (x) => !x[0].disabled && !x[3].disabled));
t('download tiles unlock too (runtime shim provides them)', await p.$$eval('.dl-tile', (x) => !x[1].disabled && !x[2].disabled));
t('subtitle says all pages', (await p.$eval('.dl-tile span', (n) => n.textContent)).includes('all pages'));

const checked = () => p.$$eval('.pagepick-row input', (n) => n.filter((x) => x.checked).length);
const clickRow = (i) => p.evaluate((i) => document.querySelectorAll('.pagepick-row input')[i].click(), i);
const clickAll = () => p.evaluate(() => document.querySelector('.pagepick-all input').click());
const settle = () => new Promise((r) => setTimeout(r, 180));

await clickRow(0); await settle();
t(`deselecting one leaves 5 (${await checked()})`, (await checked()) === 5);
t('count in the subtitle follows', (await p.$eval('.dl-tile span', (n) => n.textContent)).includes('5 pages'));

// "All pages" is indeterminate at 5 of 6; clicking it selects everything.
await clickAll(); await settle();
t(`"All pages" reselects everything (${await checked()})`, (await checked()) === 6);

await clickAll(); await settle();
t(`"All pages" again clears everything (${await checked()})`, (await checked()) === 0);
t('nothing selected disables the actions', await p.$$eval('.dl-tile', (x) => x.every((n) => n.disabled)));

await clickAll(); await settle();
t('and selects them all back', (await checked()) === 6);

console.log('\n=== clicking the row, not just the box, works once ===');
await p.evaluate(() => {
  const row = document.querySelectorAll('.pagepick-row')[1];
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await settle();
t(`row click toggles exactly one (${await checked()})`, (await checked()) === 5);

console.log('\n=== print filter hides unpicked pages ===');
await clickRow(2); await settle();
t(`two pages now excluded (${6 - (await checked())})`, (await checked()) === 4);
await p.evaluate(() => [...document.querySelectorAll('.dl-tile')].find((x) => x.textContent.startsWith('Print')).click());
await new Promise((r) => setTimeout(r, 400));
const hidden = await p.$$eval('#docscroll .sheet.not-printed', (n) => n.length);
t(`2 pages excluded from the print (${hidden})`, hidden === 2);
await new Promise((r) => setTimeout(r, 1700));
t('filter cleared afterwards', (await p.$$eval('#docscroll .sheet.not-printed', (n) => n.length)) === 0);

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
