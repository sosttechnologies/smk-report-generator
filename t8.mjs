import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 900 });
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await p.evaluate(() => [...document.querySelectorAll('.pill')].find((x) => x.textContent.includes('George')).click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

await p.evaluate(() => document.querySelector('#projects .side-item .dots').click());
await p.waitForSelector('.menu');
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find((x) => x.textContent === 'Delete').click());
await p.waitForSelector('.scrim');
console.log('modal open:', await p.$eval('.modal h2', (n) => n.textContent));
await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Delete').click());
for (const ms of [50, 200, 600, 1500]) {
  await new Promise((r) => setTimeout(r, ms));
  const st = await p.evaluate(() => {
    const t = document.querySelector('#toast');
    return { hidden: t.hidden, text: t.textContent, buttons: [...t.querySelectorAll('button')].map((b) => b.textContent) };
  });
  console.log(`+${ms}ms`, JSON.stringify(st));
}
await b.close();
