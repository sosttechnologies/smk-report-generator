/* The sidebar rows must stack their two lines and show icons. */
import puppeteer from 'puppeteer';
import { loadSampleSingle, makeProject, fileInto } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '\u2713' : '\u2717'} ${l}${x ? ' \u2014 ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await makeProject(p, 'Spring 2026');
await loadSampleSingle(p);
await fileInto(p, 'Spring 2026');
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));

const titles = await p.$$eval('#recents .side-item .l1', (n) => n.map((x) => x.textContent));
t('row shows only the student name', !/project|Draft/.test(titles[0]), titles[0]);
t('no second line on report rows', (await p.$$eval('#recents .side-item .l2', (n) => n.length)) === 0);
const fits = await p.evaluate(() => {
  const row = document.querySelector('#recents .side-item');
  return row.scrollWidth - row.clientWidth;
});
t(`row text does not overflow (${fits}px)`, fits <= 1);
const projLabel = await p.$eval('#projects > .side-item .l1', (n) => n.textContent);
t('project row is the name alone, no count', projLabel.trim() === 'Spring 2026', projLabel);

t('folder icon on the project row', await p.$('#projects > .side-item svg.ic') !== null);
t('chevron is an svg', await p.$('#projects .chev-btn svg') !== null);
t('document icon on nested reports', await p.$('#projects .nest .side-item svg.ic') !== null);
t('template nav has an icon', await p.$('#nav-tpl svg.ic') !== null);

const openIcon = await p.$eval('#projects > .side-item svg.ic', (n) => n.innerHTML.length);
await p.evaluate(() => document.querySelector('#projects > .side-item').click());
await new Promise((r) => setTimeout(r, 250));
const shutIcon = await p.$eval('#projects > .side-item svg.ic', (n) => n.innerHTML.length);
t('folder icon changes between open and closed', openIcon !== shutIcon);

const overflow = await p.evaluate(() => {
  const s = document.querySelector('#sidebar');
  return s.scrollWidth - s.clientWidth;
});
t(`sidebar does not scroll sideways (${overflow}px)`, overflow <= 1);
t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 3).join('\n'));
await p.screenshot({ path: '/tmp/shots/12-sidebar.png', clip: { x: 0, y: 0, width: 300, height: 560 } });
await b.close();
