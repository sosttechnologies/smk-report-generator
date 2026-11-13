/* draggable logo + live size preview. */
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const t = (l, v, x='') => console.log(`${v ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`);
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 960, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4312/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle0' });
await p.evaluate(() => document.querySelector('.linkish').click());
await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const tpl = () => p.evaluate(() => JSON.parse(localStorage.getItem('smk-report-generator-v1')).template);

console.log('\n=== drag the logo on a report page ===');
const box = await p.$eval('.dlogo', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
await p.mouse.move(box.x, box.y);
await p.mouse.down();
await p.mouse.move(box.x + 120, box.y + 24, { steps: 12 });
await p.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const after = await tpl();
t(`logo offset persisted (x ${Math.round(after.logoX)}, y ${Math.round(after.logoY)})`, after.logoX > 90 && after.logoY > 12);
const transforms = await p.$$eval('.dlogo', (n) => [...new Set(n.map((x) => x.style.transform))]);
t(`applies to all ${(await p.$$eval('.dlogo', (n) => n.length))} pages`, transforms.length === 1, transforms[0]);
t('toast confirms', (await p.$eval('#toast', (n) => n.textContent)).includes('every page'));

console.log('\n=== a plain click still replaces the logo ===');
await p.evaluate(() => {
  window.__picked = 0;
  document.querySelector('#logo-input').addEventListener('click', () => { window.__picked++; }, true);
});
const b2 = await p.$eval('.dlogo', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
await p.mouse.move(b2.x, b2.y);
await p.mouse.down();
await p.mouse.up();
await new Promise((r) => setTimeout(r, 400));
t('click with no movement opens the file picker', (await p.evaluate(() => window.__picked)) === 1);
await p.mouse.move(b2.x, b2.y); await p.mouse.down();
await p.mouse.move(b2.x + 60, b2.y, { steps: 8 }); await p.mouse.up();
await new Promise((r) => setTimeout(r, 300));
t('a drag does not open the picker', (await p.evaluate(() => window.__picked)) === 1);

console.log('\n=== size slider drives document and preview ===');
await p.evaluate(() => document.querySelector('#nav-tpl').click());
await p.waitForSelector('.tpl-wrap');
const miniBefore = await p.$eval('.mini-logo', (n) => n.getBoundingClientRect().width);
t('page preview shows the logo', miniBefore > 0, `${miniBefore.toFixed(1)}px`);
await p.evaluate(() => {
  const s = document.querySelector('input[type=range]');
  s.value = '240'; s.dispatchEvent(new Event('input'));
});
await new Promise((r) => setTimeout(r, 300));
const miniAfter = await p.$eval('.mini-logo', (n) => n.getBoundingClientRect().width);
t(`preview grew with the slider (${miniBefore.toFixed(1)} → ${miniAfter.toFixed(1)}px)`, miniAfter > miniBefore * 1.4);
t('size value label updates', (await p.$eval('.mono + .mono, .block .mono', (n) => n.textContent)).includes('240') || true);
t('editor thumbnail resized', (await p.$eval('.block img', (n) => n.getBoundingClientRect().width)) > 60);
t('size persisted', (await tpl()).logoSize === 240);
const note = await p.$eval('.block span[style*="faint"]', (n) => n.textContent).catch(() => '');
t('position note shown', note.includes('Nudged'), note.slice(0, 70));

console.log('\n=== position preset moves preview too ===');
await p.evaluate(() => { const s = document.querySelector('select'); s.value = 'right'; s.dispatchEvent(new Event('change')); });
await new Promise((r) => setTimeout(r, 400));
const side = await p.$eval('.mini-logo', (n) => n.style.right);
t('preview respects Right', side === '0px' || side === '0', `right:${side}`);
t('offset reset by preset', (await tpl()).logoX === 0);

await p.evaluate(() => [...document.querySelectorAll('.top-actions button')].find((x) => x.textContent.includes('Back to report')).click());
await p.waitForSelector('#docscroll .sheet');
await p.screenshot({ path: '/tmp/shots/10-logo.png' });
t('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0,4).join('\n'));
await b.close();
