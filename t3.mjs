/* Scenario 3: malformed and awkward uploads must degrade, never crash. */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, extra='') => console.log(`${v ? '✓' : '✗'} ${l}${extra ? ' — ' + extra : ''}`);

async function fresh() {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', (e) => console.log('   PAGEERROR:', e.message));
  await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  return p;
}
async function upload(p, files) {
  const inp = await p.$('#file-input');
  await inp.uploadFile(...files);
  await p.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.frow .st')];
    return rows.length && rows.every((r) => !r.textContent.includes('Reading'));
  }, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 250));
}

console.log('\n=== broken + empty + wrong-header files ===');
let p = await fresh();
await upload(p, ['/tmp/fx/broken.xlsx', '/tmp/fx/empty.csv', '/tmp/fx/wrong-headers.csv']);
const sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('three rows shown, all Failed', sts.length === 3 && sts.every((s) => s === 'Failed'), sts.join(' | '));
t('failure banner shown', (await p.$eval('#screen', (n) => n.textContent)).includes('could not be read'));
t('Generate stays disabled', await p.$eval('.sticky-foot .btn', (n) => n.disabled));
t('app did not crash', await p.$('#sidebar') !== null);
await p.close();

console.log('\n=== good file alongside broken ones ===');
p = await fresh();
await upload(p, ['/tmp/fx/broken.xlsx', '/tmp/fx/minimal.csv']);
const sts2 = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('one Failed, one Read', sts2.includes('Failed') && sts2.includes('✓ Read'), sts2.join(' | '));
t('Generate enabled anyway', !(await p.$eval('.sticky-foot .btn', (n) => n.disabled)));
await p.close();

console.log('\n=== minimal: 1 student, 1 subject, 1 week ===');
p = await fresh();
await upload(p, ['/tmp/fx/minimal.csv']);
t('detection line', true, await p.$eval('.detect', (n) => n.textContent.trim()));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
const pages = await p.$$eval('#docscroll .sheet', (n) => n.length);
const trows = await p.$$eval('.dtable tbody tr', (n) => n.length);
t(`renders ${pages} pages with ${trows} table row`, pages >= 3 && trows === 1);
const empties = await p.$$eval('.dl td:nth-child(2)', (n) => n.filter((x) => !x.textContent.trim()).length);
t('no empty section bodies', empties === 0);
await p.close();

console.log('\n=== two students in one upload ===');
p = await fresh();
await upload(p, ['/tmp/fx/two-students.csv']);
const warn = await p.$eval('#screen', (n) => n.textContent);
t('warns about multiple students', warn.includes('students detected'));
const who = await p.$$eval('.card input', (n) => n[0].value);
t(`picks one student (${who})`, !!who);
await p.close();

console.log('\n=== messy: dup rows, missing name, bad date, case drift ===');
p = await fresh();
await upload(p, ['/tmp/fx/messy.csv']);
const det = await p.$eval('.detect', (n) => n.textContent);
t('still produced a term', det.includes('subject'), det.trim());
t('canonicalised maths/MATHS into one subject', det.includes('2 subject'), det.trim());
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
t('generated despite messy input', true);
await p.close();

console.log('\n=== adding files after the first batch ===');
p = await fresh();
await upload(p, ['/tmp/fx/minimal.csv']);
await upload(p, ['/tmp/fx/minimal.csv']);
const rows = await p.$$eval('.frow', (n) => n.length);
const det2 = await p.$eval('.detect', (n) => n.textContent);
t(`two file rows (${rows}) but deduped responses`, rows === 2 && det2.includes('1 weekly response'), det2.trim());
await p.close();

await b.close();
