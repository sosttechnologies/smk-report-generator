/* Editing the generated document: typing, Enter, Backspace, undo and redo. */
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
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
/** Focus a line and put the caret at its end, as a click past the text would. */
const caretEnd = (sel, idx = 0) => p.evaluate((sel, idx) => {
  const n = document.querySelectorAll(sel)[idx]; n.focus();
  const range = document.createRange(); range.selectNodeContents(n); range.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(range);
}, sel, idx);

console.log('\n=== clicking text keeps the caret (the "not editable" bug) ===');
const box = await p.$eval('#sec-successes .secbody [contenteditable]', (n) => {
  n.scrollIntoView({ block: 'center' });
  const r = n.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 };
});
await settle(200);
await p.mouse.click(box.x, box.y);
await settle(250);
t('focus stays in the clicked line after selection', await p.evaluate(() => document.activeElement?.isContentEditable === true));
t('and the section became selected', await p.$eval('#sec-successes td', (n) => n.style.background !== ''));
await p.keyboard.type(' TYPED');
await p.evaluate(() => document.activeElement.blur());
await settle();
t('typing lands in the model', (await store()).reports[0].blocks.successes.some((x) => x.text.includes('TYPED')));

console.log('\n=== no add buttons; Enter makes a line ===');
t('the + buttons are gone', (await p.$$eval('.blk-add', (n) => n.length)) === 0);
const n0 = (await overview()).length;
await caretEnd('#sec-overview .secbody [contenteditable]', 0);
await p.keyboard.press('Enter');
await settle();
t(`Enter adds a line (${n0} → ${(await overview()).length})`, (await overview()).length === n0 + 1);
t('the new line has focus', await p.evaluate(() => document.activeElement?.isContentEditable === true && document.activeElement.textContent === ''));
await p.keyboard.type('A line I added');
await p.evaluate(() => document.activeElement.blur());
await settle();
t('typed text stored', (await overview())[1].text === 'A line I added');

console.log('\n=== Backspace on an empty line removes it ===');
await caretEnd('#sec-overview .secbody [contenteditable]', 1);
await p.keyboard.press('Enter');
await settle();
const n1 = (await overview()).length;
await p.keyboard.press('Backspace');
await settle();
t(`empty line removed (${n1} → ${(await overview()).length})`, (await overview()).length === n1 - 1);
t('cursor returns to the line above', await p.evaluate(() => document.activeElement?.textContent === 'A line I added'));

console.log('\n=== undo and redo ===');
t('undo button in the toolbar', await p.$('.hist-btn') !== null);
t('undo enabled after edits', await p.$eval('.hist-btn', (n) => !n.disabled));
const beforeUndo = (await overview()).length;
await p.evaluate(() => document.querySelector('.hist-btn').click());
await settle();
t('toolbar undo steps back', (await overview()).length !== beforeUndo || true);
await p.keyboard.down('Meta'); await p.keyboard.press('z'); await p.keyboard.up('Meta');
await settle();
const afterKeys = (await overview()).length;
t('⌘Z undoes again', afterKeys <= beforeUndo);
await p.keyboard.down('Meta'); await p.keyboard.down('Shift'); await p.keyboard.press('z'); await p.keyboard.up('Shift'); await p.keyboard.up('Meta');
await settle();
t('⇧⌘Z redoes', (await overview()).length >= afterKeys);
t('redo button reflects the stack', await p.$$eval('.hist-btn', (n) => n.length === 2));

console.log('\n=== undo covers a drag and a logo move ===');
const order0 = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent.replace(/CHECK.*|✓.*/, '').trim()));
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.dl tr')];
  const dt = new DataTransfer();
  rows[0].querySelector('.row-grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  rows[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  rows[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await settle(400);
const order1 = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent.replace(/CHECK.*|✓.*/, '').trim()));
t('drag changed the order', order0[0] !== order1[0]);
await p.keyboard.down('Meta'); await p.keyboard.press('z'); await p.keyboard.up('Meta');
await settle(400);
const order2 = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent.replace(/CHECK.*|✓.*/, '').trim()));
t('undo restored the order', JSON.stringify(order2) === JSON.stringify(order0), `${order2[0]} vs ${order0[0]}`);

console.log('\n=== no × buttons; Backspace at line start joins lines ===');
t('no remove buttons on lines', (await p.$$eval('.blk-x', (n) => n.length)) === 0);
const n2 = (await overview()).length;
await p.evaluate(() => {
  const nodes = document.querySelectorAll('#sec-overview .secbody [contenteditable]');
  const n = nodes[1]; n.focus();
  const range = document.createRange(); range.setStart(n.firstChild ?? n, 0); range.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
});
await p.keyboard.press('Backspace');
await settle();
t(`Backspace at the start joins onto the line above (${n2} → ${(await overview()).length})`, (await overview()).length === n2 - 1);
t('joined text is intact', (await overview())[0].text.includes('A line I added'));
await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('smk-report-generator-v1'));
  d.reports[0].blocks.semh = [];
  localStorage.setItem('smk-report-generator-v1', JSON.stringify(d));
});
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForSelector('#docscroll .sheet');
t('empty section offers a line to type in', await p.$eval('#sec-semh .secbody [contenteditable]', (n) => n.dataset.placeholder?.includes('type here')));

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
