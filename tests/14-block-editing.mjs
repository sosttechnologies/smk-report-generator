/* Adding and removing lines in a generated report. */
import puppeteer from 'puppeteer';
import { loadSampleSingle, generate } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1480, height: 1000 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await loadSampleSingle(p); await generate(p);
const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')));
const overview = async () => (await store()).reports[0].blocks.overview;

console.log('\n=== add a paragraph, a bullet and a heading ===');
t('add controls exist on every section', (await p.$$eval('.blk-add', (n) => n.length)) >= 9);
const before = (await overview()).length;
await p.evaluate(() => [...document.querySelectorAll('#sec-overview .blk-add-btn')]
  .find((x) => x.textContent.includes('Paragraph')).click());
await new Promise((r) => setTimeout(r, 300));
let blocks = await overview();
t(`paragraph added (${before} → ${blocks.length})`, blocks.length === before + 1 && blocks.at(-1).type === 'p');
t('the new line has focus', await p.evaluate(() => document.activeElement?.isContentEditable === true));

await p.evaluate(() => [...document.querySelectorAll('#sec-overview .blk-add-btn')]
  .find((x) => x.textContent.includes('Bullet')).click());
await new Promise((r) => setTimeout(r, 300));
blocks = await overview();
t('bullet added', blocks.at(-1).type === 'li');
t('bullet renders in a list', (await p.$$eval('#sec-overview ul li', (n) => n.length)) === 1);

await p.evaluate(() => [...document.querySelectorAll('#sec-overview .blk-add-btn')]
  .find((x) => x.textContent.includes('Heading')).click());
await new Promise((r) => setTimeout(r, 300));
t('heading added', (await overview()).at(-1).type === 'h');

console.log('\n=== type into a new line ===');
await p.evaluate(() => {
  const nodes = document.querySelectorAll('#sec-overview .secbody [contenteditable]');
  const n = nodes[nodes.length - 1];
  n.focus(); n.textContent = 'A HEADING I ADDED'; n.dispatchEvent(new Event('blur'));
});
await new Promise((r) => setTimeout(r, 300));
t('typed text is stored', (await overview()).at(-1).text === 'A HEADING I ADDED');
t('and shown on the page', (await p.$eval('#sec-overview', (n) => n.textContent)).includes('A HEADING I ADDED'));

console.log('\n=== remove a line ===');
const n0 = (await overview()).length;
await p.evaluate(() => document.querySelectorAll('#sec-overview .blk-x')[0].click());
await new Promise((r) => setTimeout(r, 300));
t(`line removed (${n0} → ${(await overview()).length})`, (await overview()).length === n0 - 1);

console.log('\n=== undo brings it back ===');
await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[0].click());
await p.waitForFunction(() => document.querySelector('.panel-foot'));
const hasUndo = await p.evaluate(() => [...document.querySelectorAll('#panel button')].some((x) => x.textContent === 'Undo'));
t('undo offered for the removal', hasUndo);
if (hasUndo) {
  await p.evaluate(() => [...document.querySelectorAll('#panel button')].find((x) => x.textContent === 'Undo').click());
  await new Promise((r) => setTimeout(r, 300));
  t('line restored', (await overview()).length === n0);
}

console.log('\n=== empty section can be filled from nothing ===');
await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('smk-report-generator-v1'));
  d.reports[0].blocks.semh = [];
  localStorage.setItem('smk-report-generator-v1', JSON.stringify(d));
});
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForSelector('#docscroll .sheet');
t('empty section says so', (await p.$eval('#sec-semh', (n) => n.textContent)).includes('Nothing recorded'));
t('and still offers the add controls', (await p.$$eval('#sec-semh .blk-add-btn', (n) => n.length)) === 3);

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
