/* Many students in one upload produce many reports. */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 980 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')));

await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await new Promise((r) => setTimeout(r, 400));

console.log('\n=== every student is listed and editable ===');
const rows = await p.$$eval('.stu-row', (n) => n.length);
t(`${rows} student rows shown`, rows === 3);
const names = await p.$$eval('.stu-name', (n) => n.map((x) => x.value));
t('all names prefilled', names.length === 3 && names.every(Boolean), names.join(', '));
t('each has its own key-stage field', (await p.$$eval('.stu-ks', (n) => n.length)) === 3);
t('button offers all three', (await p.$eval('.sticky-foot .btn', (n) => n.textContent)).includes('Generate 3 reports'));
t('no "upload the others separately" warning', !(await p.$eval('#screen', (n) => n.textContent)).includes('separately'));

console.log('\n=== deselect one ===');
await p.evaluate(() => { const c = document.querySelectorAll('.stu-row input[type=checkbox]')[2]; c.click(); });
await new Promise((r) => setTimeout(r, 250));
t('button drops to two', (await p.$eval('.sticky-foot .btn', (n) => n.textContent)).includes('Generate 2 reports'));
await p.evaluate(() => { const c = document.querySelectorAll('.stu-row input[type=checkbox]')[2]; c.click(); });
await new Promise((r) => setTimeout(r, 250));

console.log('\n=== edit a name and key stage before generating ===');
await p.evaluate(() => {
  const n = document.querySelectorAll('.stu-name')[1];
  n.value = 'Edited Name'; n.dispatchEvent(new Event('input'));
  document.querySelectorAll('.stu-ks').forEach((k, i) => { k.value = `KS ${i + 2}`; k.dispatchEvent(new Event('input')); });
});
await new Promise((r) => setTimeout(r, 200));

console.log('\n=== generate them all ===');
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#screen').textContent.includes('Writing 3 reports'), { timeout: 10000 });
t('generating screen names the batch', true);
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));

const d = await store();
t(`${d.reports.length} reports created`, d.reports.length === 3);
t('edited name used', d.reports.some((r) => r.student === 'Edited Name'), d.reports.map((r) => r.student).join(', '));
t('key stages applied', d.reports.every((r) => /^KS /.test(r.keyStage)), d.reports.map((r) => r.keyStage).join(', '));
t('each has its own sections', d.reports.every((r) => Object.keys(r.blocks).length >= 8));
t('all in the chosen project', new Set(d.reports.map((r) => r.projectId)).size === 1);

console.log('\n=== all four are reachable and editable ===');
const recents = await p.$$eval('#recents .side-item', (n) => n.length);
t(`${recents} in recents`, recents === 3);
const nested = await p.$$eval('#projects .nest .side-item', (n) => n.length);
t(`${nested} under the project`, nested === 3);
for (let i = 0; i < 3; i++) {
  await p.evaluate((idx) => document.querySelectorAll('#recents .side-item')[idx].click(), i);
  await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 8000 });
  const who = await p.$eval('#docscroll .dmeta', (n) => n.textContent);
  const edited = await p.evaluate((idx) => {
    const n = document.querySelector('#sec-overview p');
    n.focus(); n.textContent = `EDIT ${idx}`; n.dispatchEvent(new Event('blur'));
    return true;
  }, i);
  t(`report ${i + 1} opens and edits (${who.split('YEAR')[0].trim().slice(0, 34)})`, edited);
}
const after = await store();
t('all three edits persisted independently',
  new Set(after.reports.map((r) => r.blocks.overview[0].text)).size === 3);

console.log('\n=== no vendor branding anywhere ===');
const text = await p.evaluate(() => document.body.innerText);
t('no "Claude" in the UI', !/claude/i.test(text));
t('no "Drafted by" text', !/drafted by/i.test(text));
t('reports carry no provenance field', after.reports.every((r) => !('provenance' in r)));

t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await p.screenshot({ path: '/tmp/shots/13-batch.png' });
await b.close();
