import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: '/tmp/shots/1-upload.png' });

await p.evaluate(() => [...document.querySelectorAll('.pill')].find((x) => x.textContent.includes('George')).click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: '/tmp/shots/2-files.png' });

await p.click('.sticky-foot .btn');
await new Promise((r) => setTimeout(r, 700));
await p.screenshot({ path: '/tmp/shots/3-generating.png' });
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));
await p.screenshot({ path: '/tmp/shots/4-report.png' });

await p.evaluate(() => document.querySelectorAll('#panel .sec-row')[3].click());
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: '/tmp/shots/5-section.png' });

await p.evaluate(() => document.querySelector('#nav-tpl').click());
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: '/tmp/shots/6-template.png' });
await b.close();
console.log('shots written');
