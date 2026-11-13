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

/** Makes a project and returns to the upload screen. Projects no longer exist
 *  by default — a report stays loose in Recents until it is filed. */
export async function makeProject(p, name = 'Spring 2026') {
  await p.evaluate(() => document.querySelector('#new-proj').click());
  // A new project drops straight into inline rename with the text selected.
  await p.waitForFunction(() => document.querySelector('#projects .rename-input'), { timeout: 5000 });
  await p.evaluate((n) => {
    const i = document.querySelector('#projects .rename-input');
    i.value = n;
  }, name);
  await p.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  await p.evaluate(() => document.querySelector('#nav-new').click());
  await new Promise((r) => setTimeout(r, 250));
}

/** Picks a project in the upload card's "Save to project" select. */
export async function fileInto(p, name) {
  await p.waitForFunction((n) => [...document.querySelectorAll('#screen select')]
    .some((s) => [...s.options].some((o) => o.textContent === n)), { timeout: 5000 }, name);
  await p.evaluate((n) => {
    const sel = [...document.querySelectorAll('#screen select')].find((s) =>
      [...s.options].some((o) => o.textContent === n));
    const opt = [...sel.options].find((o) => o.textContent === n);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }, name);
  await new Promise((r) => setTimeout(r, 200));
}
