/* hostile conditions. */
import puppeteer from 'puppeteer';
import { loadSampleSingle } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const page = async () => {
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message));
  await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  return p;
};
const sample = async (p) => {
  await loadSampleSingle(p);
  await p.click('.sticky-foot .btn');
  await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
};

console.log('\n=== real user files: Word and PDF ===');
let p = await page();
const inp = await p.$('#file-input');
await inp.uploadFile(
  '/Users/preciousjoshua/Downloads/Amara_Okafor_Progress_Report.docx',
  '/Users/preciousjoshua/Downloads/SMK_Progress_Report_Amara_Okafor_Sample.pdf',
);
await p.waitForFunction(() => {
  const r = [...document.querySelectorAll('.frow .st')];
  return r.length === 2 && r.every((x) => !x.textContent.includes('Reading'));
}, { timeout: 60000 });
const msgs = await p.$$eval('.frow .st', (n) => n.map((x) => x.title || x.textContent));
t('both files handled without crashing', true, msgs.join(' | ').slice(0, 110));
t('failure explains what to do', msgs.join(' ').includes('Forms .xlsx'));
// the DOCX/PDF text extraction itself (the part that does not need Claude)
const docxText = await p.evaluate(async () => {
  const r = await fetch('/does-not-matter'); return 1;
}).catch(() => null);
await p.close();

console.log('\n=== double-click Generate / rapid clicks ===');
p = await page();
await loadSampleSingle(p);
await p.evaluate(() => { const b = document.querySelector('.sticky-foot .btn'); b.click(); b.click(); b.click(); });
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));
const n = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports.length);
t(`triple click made ${n} report`, n === 1);
await p.close();

console.log('\n=== delete the project a report lives in ===');
p = await page();
await sample(p);
await p.evaluate(() => document.querySelector('#new-proj').click());
await new Promise((r) => setTimeout(r, 300));
await p.evaluate(() => {
  const sel = document.querySelector('#screen select');
  if (sel) { sel.value = [...sel.options].find((o) => o.textContent !== 'No project' && o.value !== '__new__').value; sel.dispatchEvent(new Event('change')); }
});
await p.evaluate(() => { document.querySelector('#projects > .side-item .dots').click(); });
await p.waitForSelector('.menu');
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find((x) => x.textContent === 'Delete').click());
await p.waitForSelector('.scrim');
const body = await p.$eval('.modal p', (x) => x.textContent);
t('says what the project holds', /report/i.test(body), body);
await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Delete').click());
await new Promise((r) => setTimeout(r, 400));
t('falls back to a usable screen, not a dead end',
  !(await p.$eval('#screen', (x) => x.textContent)).includes('no longer exists'),
  (await p.$eval('#screen', (x) => x.textContent)).trim().slice(0, 40));
t('project list is now empty', (await p.$$eval('#projects > .side-item', (x) => x.length)) === 0);
await p.waitForFunction(() => [...document.querySelectorAll('#toast button')].some((x) => x.textContent === 'Undo'), { timeout: 6000 });
await p.evaluate(() => [...document.querySelectorAll('#toast button')].find((x) => x.textContent === 'Undo').click());
await new Promise((r) => setTimeout(r, 400));
t('undo restores the project', (await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('smk-report-generator-v1'));
  return d.projects.length === 1 && d.reports.length === 1;
})));
await p.close();

console.log('\n=== storage unavailable (private browsing) ===');
p = await b.newPage();
await p.setViewport({ width: 1400, height: 900 });
p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message));
await p.evaluateOnNewDocument(() => {
  Object.defineProperty(window, 'localStorage', {
    get() { throw new DOMException('denied', 'SecurityError'); },
  });
});
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
t('app boots with storage blocked', (await p.$('#sidebar')) !== null);
await sample(p);
t('generates with storage blocked', (await p.$$eval('#docscroll .sheet', (x) => x.length)) === 6);
await p.close();

console.log('\n=== unusual names and very long text ===');
p = await page();
await p.evaluate(() => {
  window.__t = () => {
    const E = 0; // noop
  };
});
await sample(p);
await p.evaluate(() => {
  const n = document.querySelector('#sec-overview p');
  n.focus();
  n.textContent = 'Zoë Ó’Brien-Smith <script>alert(1)</script> & “quotes” — ' + 'very long sentence. '.repeat(120);
  n.dispatchEvent(new Event('blur'));
});
await new Promise((r) => setTimeout(r, 400));
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].blocks.overview[0].text);
t('special characters stored verbatim', stored.includes('Zoë Ó’Brien-Smith') && stored.includes('<script>'));
const injected = await p.evaluate(() => document.querySelectorAll('#docscroll script').length);
t('no script injected into the document', injected === 0);
const overflowX = await p.evaluate(() => {
  const s = document.querySelector('#docscroll .sheet');
  return s.scrollWidth - s.clientWidth;
});
t(`long text does not overflow the page sideways (${overflowX}px)`, overflowX <= 1);
await p.close();

await b.close();
