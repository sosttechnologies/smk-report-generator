/** Shared steps for the browser suites. */

/** Loads the sample, then keeps only the first student so suites that assume a
 *  single report keep working now that the sample carries several. */
export async function loadSampleSingle(p) {
  await p.evaluate(() => document.querySelector('.linkish').click());
  await p.waitForFunction(() => document.querySelector('.frow .st')?.textContent.includes('Read'));
  // Each click re-renders the list, so the NodeList goes stale — re-query every time.
  for (;;) {
    const done = await p.evaluate(() => {
      const boxes = [...document.querySelectorAll('.stu-row input[type=checkbox]')];
      const extra = boxes.slice(1).find((c) => c.checked);
      if (!extra) return true;
      extra.click();
      return false;
    });
    if (done) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 200));
}

export async function generate(p) {
  await p.click('.sticky-foot .btn');
  await p.waitForFunction(() => document.querySelector('#docscroll .sheet'), { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
}
