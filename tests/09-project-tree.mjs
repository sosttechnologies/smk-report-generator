/* Expandable projects in the sidebar. */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1420, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')));

await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));

t('chevron rendered on the project row', await p.$('#projects .chev-btn') !== null);
t('generating auto-expands its project', (await p.$$eval('#projects .nest .side-item', (n) => n.length)) === 1);
t('nested row shows the student', (await p.$eval('#projects .nest .l1', (n) => n.textContent)).includes('Alex Sample'));
t('nested row shows status, not project name', (await p.$eval('#projects .nest .l2', (n) => n.textContent)) === 'Draft');

console.log('\n=== collapse and expand ===');
await p.evaluate(() => document.querySelector('#projects .chev-btn').click());
await new Promise((r) => setTimeout(r, 250));
t('collapsed hides children', (await p.$$eval('#projects .nest', (n) => n.length)) === 0);
t('collapse persisted', Object.keys((await store()).expandedProjects).length === 0);
await p.evaluate(() => document.querySelector('#projects .chev-btn').click());
await new Promise((r) => setTimeout(r, 250));
t('expanded again', (await p.$$eval('#projects .nest .side-item', (n) => n.length)) === 1);
t('chevron rotates when open', await p.$eval('#projects .chev-btn', (n) => n.classList.contains('open')));
t('aria-expanded set', await p.$eval('#projects .chev-btn', (n) => n.getAttribute('aria-expanded')) === 'true');

console.log('\n=== chevron must not open the project page ===');
await p.evaluate(() => document.querySelector('#projects .chev-btn').click());
await new Promise((r) => setTimeout(r, 250));
t('still on the report screen', (await p.$('#docscroll')) !== null);
await p.evaluate(() => document.querySelector('#projects .chev-btn').click());
await new Promise((r) => setTimeout(r, 250));

console.log('\n=== clicking the row still opens the project ===');
await p.evaluate(() => document.querySelector('#projects > .side-item').click());
await new Promise((r) => setTimeout(r, 300));
t('project page opened', (await p.$eval('#screen', (n) => n.textContent)).includes('1 report'));

console.log('\n=== nested row opens the report ===');
await p.evaluate(() => document.querySelector('#projects .nest .side-item').click());
await new Promise((r) => setTimeout(r, 400));
t('report opened from the tree', (await p.$('#docscroll .sheet')) !== null);

console.log('\n=== empty project ===');
await p.evaluate(() => document.querySelector('#new-proj').click());
await new Promise((r) => setTimeout(r, 300));
await p.evaluate(() => document.querySelectorAll('#projects .chev-btn')[1].click());
await new Promise((r) => setTimeout(r, 250));
t('empty project says so', (await p.$eval('#projects .nest-empty', (n) => n.textContent)) === 'No reports yet');

console.log('\n=== moving a report moves it in the tree ===');
await p.evaluate(() => document.querySelector('#projects .nest .side-item .dots')?.click()
  ?? document.querySelectorAll('#projects > .side-item')[0].querySelector('.dots').click());
await new Promise((r) => setTimeout(r, 250));
await p.evaluate(() => document.body.click());
const counts = await p.$$eval('#projects .nest', (n) => n.map((x) => x.querySelectorAll('.side-item').length));
t(`tree shows ${JSON.stringify(counts)} under the two projects`, counts.length === 2);

console.log('\n=== menu gained Expand/Collapse and New report here ===');
await p.evaluate(() => document.querySelector('#projects > .side-item .dots').click());
await p.waitForSelector('.menu');
const items = await p.$$eval('.menu button span:first-child', (n) => n.map((x) => x.textContent));
t('project menu', ['Collapse','Pin','Rename','New report here','Archive','Delete'].every((e) => items.some((i) => i.startsWith(e))), items.join(' / '));
await p.evaluate(() => document.body.click());

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0,4).join('\n'));
await p.screenshot({ path: '/tmp/shots/11-tree.png', clip: { x: 0, y: 0, width: 300, height: 600 } });
await b.close();
