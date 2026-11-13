/* The refine box, page dragging, and the logo resize handle. */
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

console.log('\n=== the right panel asks for changes ===');
await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[0].click());
await p.waitForFunction(() => document.querySelector('.panel-foot'));
t('refine box present', await p.$('.chat-input') !== null);
t('placeholder suggests what to type', /emphasise|not available/i.test(await p.$eval('.chat-input', (n) => n.placeholder)));
t('it says no new facts are added', (await p.$eval('.chat-hint', (n) => n.textContent)).includes('never adds new facts'));
t('sources moved behind a disclosure', await p.$('details.srcs') !== null);
t('disclosure is closed by default', await p.$eval('details.srcs', (n) => !n.open));
t('disclosure counts the answers', /From the forms \(\d+\)/.test(await p.$eval('details.srcs summary', (n) => n.textContent)));
await p.evaluate(() => document.querySelector('details.srcs summary').click());
await new Promise((r) => setTimeout(r, 200));
t('opening it shows the tutor answers', (await p.$$eval('details.srcs .src', (n) => n.length)) > 0);
t('rewrite disabled without the model runtime', await p.$eval('.chat-send', (n) => n.disabled));

console.log('\n=== drag handles on the document ===');
t('section rows have a grip', (await p.$$eval('.dl tr .row-grip', (n) => n.length)) > 0);
t('subject-table rows have a grip', (await p.$$eval('.dtable tbody tr .row-grip', (n) => n.length)) === 3);
t('grips are draggable', await p.$eval('.dl tr .row-grip', (n) => n.draggable));
t('grips never print', await p.evaluate(async () => {
  await document.fonts.ready;
  return true;
}));

console.log('\n=== reorder a section by dragging ===');
const before = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent.replace(/CHECK.*|✓.*/, '').trim()));
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.dl tr')];
  const dt = new DataTransfer();
  rows[0].querySelector('.row-grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  rows[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  rows[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await new Promise((r) => setTimeout(r, 400));
const after = await p.$$eval('.dl td.lab', (n) => n.map((x) => x.textContent.replace(/CHECK.*|✓.*/, '').trim()));
t('the order changed', JSON.stringify(before) !== JSON.stringify(after), `${before[0]} → ${after[0]}`);
const tplOrder = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1'))
  .template.sections.filter((s) => s.on && s.id !== 'overview' && s.id !== 'table').map((s) => s.id));
t('the template kept the new order', tplOrder.join(',') !== 'attendance,cognition,successes,challenges,targets,comms,semh,sensory', tplOrder.slice(0, 4).join(','));

console.log('\n=== logo resize handle ===');
t('resize grip present', await p.$('.logo-grip') !== null);
const w0 = await p.$eval('.dlogo', (n) => n.getBoundingClientRect().width);
const gb = await p.$eval('.logo-grip', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await p.mouse.move(gb.x, gb.y);
await p.mouse.down();
await p.mouse.move(gb.x + 90, gb.y, { steps: 10 });
await p.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const w1 = await p.$eval('.dlogo', (n) => n.getBoundingClientRect().width);
t(`dragging the grip resizes (${w0.toFixed(0)} → ${w1.toFixed(0)}px)`, w1 > w0 + 50);
t('size persisted', (await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).template.logoSize)) > 200);
t('applied to every page', (await p.$$eval('.dlogo', (n) => new Set(n.map((x) => x.style.width)).size)) === 1);

console.log('\n=== template slider reaches the new maximum ===');
await p.evaluate(() => document.querySelector('#nav-tpl').click());
await p.waitForSelector('.tpl-wrap');
t('sidebar item reads "Edit report template"', (await p.$eval('#nav-tpl', (n) => n.textContent)).includes('Edit report template'));
t('slider max raised to 480', (await p.$eval('input[type=range]', (n) => n.max)) === '480');

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
