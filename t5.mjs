import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await p.evaluate(() => [...document.querySelectorAll('.pill')].find((x) => x.textContent.includes('George')).click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });

// select overview so the panel shows its change log
await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[0].click());
await p.waitForFunction(() => document.querySelector('.panel-foot'));

const orig = await p.$eval('#sec-overview p', (n) => n.textContent);
console.log('original :', orig.slice(0, 50) + '…');

const step = async (text) => {
  await p.evaluate((t) => {
    const n = document.querySelector('#sec-overview p');
    n.focus(); n.textContent = t; n.dispatchEvent(new Event('blur'));
  }, text);
  await new Promise((r) => setTimeout(r, 250));
  return p.evaluate(() => ({
    dom: document.querySelector('#sec-overview p').textContent,
    model: JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].blocks.overview[0].text,
    undoBtn: [...document.querySelectorAll('#panel button')].some((x) => x.textContent === 'Undo'),
    hist: JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].history?.overview?.length ?? 0,
  }));
};

console.log('after edit 1:', JSON.stringify(await step('FIRST')));
console.log('after edit 2:', JSON.stringify(await step('SECOND')));

await p.evaluate(() => [...document.querySelectorAll('#panel button')].find((x) => x.textContent === 'Undo')?.click());
await new Promise((r) => setTimeout(r, 300));
console.log('after undo  :', JSON.stringify(await p.evaluate(() => ({
  dom: document.querySelector('#sec-overview p').textContent,
  model: JSON.parse(localStorage.getItem('smk-report-generator-v1')).reports[0].blocks.overview[0].text,
}))));

// project screen check
await p.evaluate(() => document.querySelector('#new-proj').click());
await new Promise((r) => setTimeout(r, 300));
console.log('project screen input value:', await p.$eval('#screen input', (n) => n.value).catch(() => 'NO INPUT'));
console.log('project screen has empty state:', (await p.$eval('#screen', (n) => n.textContent)).includes('No reports here yet'));
await b.close();
