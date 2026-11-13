/* SMK's own weekly report documents are read with no model at all.
 *
 * The static server here has no backend, so `sample` is null: anything that gets
 * read in this suite was read by matching the template, in the browser. Fixtures
 * are built on the fly with placeholder names — a Word-style text file in the
 * headed layout, and a real PDF (printed by Chromium) in the Microsoft Form layout
 * with ●/○ radio marks, holding two reports. */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const t = (l, v, extra = '') => console.log(`${v ? '✓' : '✗'} ${l}${extra ? ' — ' + extra : ''}`);
fs.mkdirSync('/tmp/fx', { recursive: true });

/* Layout A — what mammoth gives for the Word report, headings glued as they come. */
fs.writeFileSync('/tmp/fx/weekly-word.txt', [
  'WEEKLY PROGRESS REPORTREPORTING WEEK: WEEK COMMENCING 09/11/2026',
  'STUDENT: ALEX SAMPLE', 'INSTRUCTOR: TUTOR A', 'SUBJECT: GCSE MATHEMATICS',
  'ACADEMIC YEAR: 2026-2027 (AUTUMN TERM)',
  'PERFORMANCE & ENGAGEMENT MATRIX',
  'Attendance', 'Average', 'Meets deadlines', 'Excellent', 'Punctuality', 'Good',
  'Quality of work', 'Good', 'Preparation for class', 'Good', 'Understands key terms', 'Good',
  'Homework completion', 'Excellent', 'Applies knowledge to new concepts', 'Average',
  'Overall Engagement', 'Good', 'Acts on feedback', 'Excellent',
  'ATTENDANCE &PUNCTUALITY',
  'Weekly Attendance Status: Absent on some day/s during the week (missed Wednesday).Observations: Attendance is rated Average due to the missed session.',
  'CURRICULUM PROGRESS& SUCCESSES',
  'Strengths & Achievements:• Positive attitude to learning.• Hands homework in on time.',
  'AREAS FOR DEVELOPMENT& CONCERNS',
  'Key Concerns:• Simultaneous Equations: missed the lesson introducing them.• Multi-step worded problems: misreads the question under time pressure.',
  'TARGETS OR GOALS &KEY ACTIONS',
  'Agreed Action Plan:1. Catch-up session on simultaneous equations on Monday.2. Practise worded problems twice a week.',
  'SPECIAL CONSIDERATIONS& ACCESS ARRANGEMENTS',
  'Assessment Observations & Recommendations:Often runs out of time in assessments.Recommendation: assess for 25% extra time.',
  'INSTRUCTORGENERAL COMMENTS',
  'A polite, hardworking student with a very positive attitude to learning.',
  'SIGN-OFF &VERIFICATION', 'Tutor / Instructor: Tutor A Date: 13/11/2026',
].join('\n'));

/* Not SMK's layout at all. */
fs.writeFileSync('/tmp/fx/other.txt', 'Minutes of the staff meeting, 12 November. Present: everyone. Apologies: none.');

/* Layout B — the Microsoft Form printed to PDF. */
const b = await puppeteer.launch({ headless: true });
const grid = (rows, cols) => `<table><tr><td></td>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${
  rows.map(([label, pick]) => `<tr><td>${label}</td>${cols.map((c) => `<td>${c === pick ? '●' : '○'}</td>`).join('')}</tr>`).join('')}</table>`;
const E5 = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'NOT APPLICABLE'];
const E4 = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'];
const form = (f) => `<section style="page-break-after:always">
<p class="hdr">SMK Student Progress Report - Sample data (fictional student) &nbsp; Page 1</p>
<h1>SMK STUDENT PROGRESS REPORT</h1><p>Weekly instructor submission | Submitted ${f.submitted} | SAMPLE DATA</p>
<h2>1. STUDENT NAME</h2><p>${f.student}</p>
<h2>2. INSTRUCTOR NAME</h2><p>${f.tutor}</p>
<h2>3. SUBJECT</h2><p>${f.subject}</p>
<h2>4. REPORTING WEEK (WEEK BEGINNING)</h2><p>${f.week}</p>
<h2>5. WEEKLY ATTENDANCE</h2>
<p>${f.att === 'full' ? '●' : '○'} &nbsp; 100% WEEKLY ATTENDANCE</p>
<p>${f.att === 'none' ? '●' : '○'} &nbsp; 0% WEEKLY ATTENDANCE</p>
<p>${f.att === 'partial' ? '●' : '○'} &nbsp; ABSENT ON SOME DAY/S DURING THE WEEK</p>
<h2>6. STUDENT ENGAGEMENT</h2>${grid(f.eng, E5)}
<h2>7. ACADEMICS</h2>${grid(f.aca, E4)}
<h2>8. CONCERNS</h2><p>${f.concerns}</p>
<h2>9. KEY ACTIONS</h2><p>${f.actions.map((a) => '• ' + a).join(' ')}</p>
<h2>10. GENERAL COMMENTS</h2><p>${f.general}</p>
</section>`;
const html = `<!doctype html><meta charset="utf-8"><style>body{font:11pt Arial}h2{font-size:11pt}td,th{padding:2px 10px;font-weight:normal}.hdr{color:#888;font-size:9pt}</style>
${form({
  submitted: '20/11/2026', student: 'Robin Example', tutor: 'Tutor B', subject: 'GCSE English Literature', week: '16/11/2026', att: 'full',
  eng: [['Attendance', 'EXCELLENT'], ['Punctuality', 'EXCELLENT'], ['Preparation for Class', 'GOOD'], ['Homework completion', 'AVERAGE']],
  aca: [['Meets Deadlines', 'AVERAGE'], ['Quality of work', 'GOOD'], ['Understands key terms', 'EXCELLENT'], ['Applies knowledge and understanding to new concepts', 'EXCELLENT'], ['Acts on feedback', 'GOOD']],
  concerns: 'Spoken answers are much stronger than written work. Two homework tasks were handed in late.',
  actions: ['Try a typed essay in class next week', 'Agree a homework planner and check it each Monday'],
  general: 'An enthusiastic and articulate student who brings real insight to class discussions.',
})}
${form({
  submitted: '27/11/2026', student: 'Robin Example', tutor: 'Tutor B', subject: 'GCSE English Literature', week: '23/11/2026', att: 'partial',
  eng: [['Attendance', 'AVERAGE'], ['Punctuality', 'GOOD'], ['Preparation for Class', 'GOOD'], ['Homework completion', 'GOOD']],
  aca: [['Meets Deadlines', 'GOOD'], ['Quality of work', 'GOOD'], ['Understands key terms', 'EXCELLENT'], ['Applies knowledge and understanding to new concepts', 'GOOD'], ['Acts on feedback', 'EXCELLENT']],
  concerns: 'Missed Thursday and has not yet caught up on the poetry comparison.',
  actions: ['Share the poetry comparison notes', 'Short catch-up before Monday'],
  general: 'The typed essay was far stronger than the handwritten one — worth pursuing.',
})}`;
{
  const pg = await b.newPage();
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.pdf({ path: '/tmp/fx/weekly-form.pdf', format: 'A4' });
  await pg.close();
}

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
    return rows.length && rows.every((r) => !/Reading|Queued/.test(r.textContent));
  }, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 300));
}

console.log('\n=== Word-layout report, no model present ===');
let p = await fresh();
t('no model is available in this view', await p.evaluate(() => !window.claude));
await upload(p, ['/tmp/fx/weekly-word.txt']);
let sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('file read', sts[0] === '✓ Read', sts.join(' | '));
let de = await p.$eval('.frow .de', (n) => n.textContent);
t('one Mathematics response', /1 response · Mathematics/.test(de), de);
await p.click('.frow.clickable');
await p.waitForSelector('.fprev');
let prev = await p.$eval('.fprev', (n) => n.textContent);
t('preview says it was read from the layout, not a model', /no model involved/.test(prev));
t('preview shows the student', /Alex Sample/.test(prev));
t('derived ratings landed', /Attendance: Average/.test(prev) && /Homework completion: Excellent/.test(prev), prev.slice(0, 200));
t('week found', /09\/11\/2026|9 Nov|Nov 2026|2026-11-09/.test(prev) || /w\/c/.test(prev), prev.slice(0, 300));
await p.close();

console.log('\n=== Form-layout PDF with two weeks, plus the Word report ===');
p = await fresh();
await upload(p, ['/tmp/fx/weekly-form.pdf', '/tmp/fx/weekly-word.txt']);
sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('both files read', sts.length === 2 && sts.every((s) => s === '✓ Read'), sts.join(' | '));
const des = await p.$$eval('.frow .de', (n) => n.map((x) => x.textContent));
t('PDF yielded 2 responses in English Literature', des.some((d) => /2 responses · English Literature/.test(d)), des.join(' | '));
let screen = await p.$eval('#screen', (n) => n.textContent);
t('two students found', /2 students found/.test(screen));
await p.click('.frow.clickable');
await p.waitForSelector('.fprev');
prev = await p.$eval('.fprev', (n) => n.textContent);
t('PDF preview: ratings read off the radio marks', /Punctuality: Excellent/.test(prev) && /Meets Deadlines: Average/.test(prev), prev.slice(0, 300));
t('PDF preview: both weeks', /2 responses · 1 student/.test(prev));
await p.click('.sticky-foot .btn');
await p.waitForFunction(() => document.querySelectorAll('#docscroll .sheet').length > 0, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
const reports = await p.$$eval('#recents .side-item', (n) => n.map((x) => x.textContent.trim()).filter(Boolean));
const docText = await p.$eval('#docscroll', (n) => n.textContent);
t('a report was generated', /Interim|Termly|Overview/i.test(docText));
t('the document uses what was read', /simultaneous equations|homework planner|poetry comparison|typed essay/i.test(docText), docText.slice(0, 120));
t('sidebar lists both students', reports.length === 2 && reports.some((r) => /Alex Sample/.test(r)) && reports.some((r) => /Robin Example/.test(r)), reports.join(' | '));
await p.close();

console.log('\n=== a document that is not SMK\'s layout fails clearly ===');
p = await fresh();
await upload(p, ['/tmp/fx/other.txt']);
sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
const why = await p.$eval('.frow .st', (n) => n.title);
t('marked Failed', sts[0] === 'Failed', sts.join(' | '));
t('explains it needs the SMK layout', /SMK weekly progress report layout/.test(why), why);
t('Generate stays disabled', await p.$eval('.sticky-foot .btn', (n) => n.disabled));
await p.close();

await b.close();
