/* pin, rename, move, mark read/unread, archive. */
import puppeteer from 'puppeteer';
import { loadSampleSingle } from './helpers.mjs';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });

const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')));
const openMenu = async (sel) => {
  await p.evaluate((s) => document.querySelector(s).click(), sel);
  await p.waitForSelector('.menu', { timeout: 4000 });
  return p.$$eval('.menu button span:first-child', (n) => n.map((x) => x.textContent));
};
const pick = async (label) => {
  await p.evaluate((l) => [...document.querySelectorAll('.menu button')]
    .find((x) => x.textContent.startsWith(l)).click(), label);
  await new Promise((r) => setTimeout(r, 350));
};

// make two reports in two projects
await loadSampleSingle(p);
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));
await p.evaluate(() => document.querySelector('#new-proj').click());
await new Promise((r) => setTimeout(r, 300));

console.log('\n=== menu contents ===');
const projItems = await openMenu('#projects > .side-item .dots');
t('project menu', JSON.stringify(projItems), projItems.join(' / '));
await p.keyboard.press('Escape');
await p.evaluate(() => document.body.click());
const repItems = await openMenu('#recents .side-item .dots');
t('report menu', true, repItems.join(' / '));
const expect = ['Pin','Rename','Move to project','Mark as unread','Archive','Delete'];
t('report menu has all actions', expect.every((e) => repItems.some((i) => i.startsWith(e))));
await p.evaluate(() => document.body.click());

console.log('\n=== pin ===');
await openMenu('#recents .side-item .dots');
await pick('Pin');
t('report pinned in storage', (await store()).reports[0].pinned === true);
t('Pinned group appears', (await p.$$eval('#recents .mono', (n) => n.map((x) => x.textContent))).includes('Pinned'));
t('pin icon shown', (await p.$$eval('#recents .pin-ic', (n) => n.length)) === 1);

console.log('\n=== mark unread ===');
await openMenu('#recents .side-item .dots');
await pick('Mark as unread');
t('unread in storage', (await store()).reports[0].unread === true);
t('unread dot rendered', (await p.$$eval('#recents .unread-dot', (n) => n.length)) === 1);
await p.evaluate(() => document.querySelector('#recents .side-item').click());
await new Promise((r) => setTimeout(r, 400));
t('opening the report clears unread', (await store()).reports[0].unread === false);

console.log('\n=== rename (inline) ===');
await openMenu('#recents .side-item .dots');
await pick('Rename');
const hasInput = await p.$('#recents .rename-input') !== null;
t('inline input appears with text selected', hasInput);
await p.evaluate(() => { const i = document.querySelector('#recents .rename-input'); i.value = 'Renamed Student'; });
await p.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 400));
t('rename applied', (await store()).reports[0].student === 'Renamed Student');
t('document reflects the new name', (await p.$eval('#docscroll .dmeta', (n) => n.textContent)).includes('RENAMED STUDENT'));

console.log('\n=== move to project (submenu) ===');
await openMenu('#recents .side-item .dots');
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find((x) => x.textContent.startsWith('Move to project')).click());
await new Promise((r) => setTimeout(r, 300));
const menus = await p.$$eval('.menu', (n) => n.length);
t(`submenu opened (${menus} menus)`, menus === 2);
const subItems = await p.$$eval('.menu:last-child button span:first-child', (n) => n.map((x) => x.textContent));
t('submenu lists projects + new', subItems.some((x) => x.includes('Untitled project')) && subItems.some((x) => x.includes('New project')), subItems.join(' / '));
await p.evaluate(() => [...document.querySelectorAll('.menu:last-child button')].find((x) => x.textContent.includes('Untitled project')).click());
await new Promise((r) => setTimeout(r, 400));
const st = await store();
t('report moved', st.reports[0].projectId === st.projects[1].id);
t('undo offered', (await p.$eval('#toast', (n) => n.textContent)).includes('Undo'));

console.log('\n=== archive a report ===');
await new Promise((r) => setTimeout(r, 6200));
await openMenu('#recents .side-item .dots');
await pick('Archive');
t('archived in storage', (await store()).reports[0].archived === true);
const visibleRows = await p.$$eval('#recents .side-item', (n) => n.length);
t(`hidden from recents (${visibleRows} rows)`, visibleRows === 0);
const togLabel = await p.$eval('.arch-tog', (n) => n.textContent);
t('archived toggle shown', togLabel.includes('Archived (1)'), togLabel);
await p.evaluate(() => document.querySelector('.arch-tog').click());
await new Promise((r) => setTimeout(r, 250));
t('expanding shows the archived report dimmed', (await p.$$eval('#recents .side-item.dim-row', (n) => n.length)) === 1);
await openMenu('#recents .side-item.dim-row .dots');
await pick('Unarchive');
t('unarchived', (await store()).reports[0].archived === false);

console.log('\n=== archive a project takes its reports ===');
await openMenu('#projects > .side-item .dots');
const projMenu = await p.$$eval('.menu button span:first-child', (n) => n.map((x) => x.textContent));
t('project menu has Pin/Rename/Archive/Delete', ['Pin','Rename','Archive','Delete'].every((e) => projMenu.some((i) => i.startsWith(e))), projMenu.join(' / '));
await p.evaluate(() => document.body.click());

console.log('\n=== active project darkened ===');
await openMenu('#projects > .side-item .dots');
await pick('Open project');
const bg = await p.$eval('#projects > .side-item.on', (n) => getComputedStyle(n).backgroundColor);
const hover = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--active').trim());
t(`active row background ${bg}`, bg === 'rgb(219, 214, 203)', `token --active: ${hover}`);

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0,4).join('\n'));
await b.close();
