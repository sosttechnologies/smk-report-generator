/* A half-filled form still produces a report.
 *
 * Only the student's name is required. Every other blank — subject, week,
 * attendance, ratings, comments — is given a stated default, listed in the file
 * preview, and the document says plainly what was not recorded rather than
 * inventing a grade or a sentence about it. */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const t = (l, v, extra = '') => console.log(`${v ? '✓' : '✗'} ${l}${extra ? ' — ' + extra : ''}`);
fs.mkdirSync('/tmp/fx', { recursive: true });

/* Forms export where tutors skipped most questions. Row 1: only a name and a
 * subject. Row 2: name, week, one rating. Row 3: name only — but the form's
 * Completion time stands in for the week. */
fs.writeFileSync('/tmp/fx/partial.csv', [
  'ID,Start time,Completion time,Email,Name,STUDENT NAME,INSTRUCTURE NAME,SUBJECT,REPORTING WEEK (WEEK BEGINNING),WEEKLY ATTENDANCE,STUDENT ENGAGEMENT.Attendance,STUDENT ENGAGEMENT.Punctuality,ACADEMICS.Quality of work,CONCERNS,KEY ACTIONS,GENERAL COMMENTS',
  '1,,,,,Alex Sample,,Mathematics,,,,,,,,',
  '2,,,,,Alex Sample,Tutor A,,12/01/2026,,Good,,,,,',
  '3,,19/01/2026 10:04,,,Robin Example,,,,,,,,,,',
].join('\n'));

/* The Word layout with the week, attendance, ratings and every comment left blank. */
fs.writeFileSync('/tmp/fx/partial-word.txt', [
  'WEEKLY PROGRESS REPORTREPORTING WEEK: WEEK COMMENCING',
  'STUDENT: SAM PLACEHOLDER', 'INSTRUCTOR:', 'SUBJECT: GCSE SCIENCE',
  'PERFORMANCE & ENGAGEMENT MATRIX',
  'Attendance', '', 'Meets deadlines', '', 'Punctuality', '',
  'ATTENDANCE &PUNCTUALITY', 'Weekly Attendance Status:',
  'CURRICULUM PROGRESS& SUCCESSES', 'Strengths & Achievements:',
  'AREAS FOR DEVELOPMENT& CONCERNS', 'Key Concerns:',
  'TARGETS OR GOALS &KEY ACTIONS', 'Agreed Action Plan:',
  'INSTRUCTORGENERAL COMMENTS',
  'SIGN-OFF &VERIFICATION', 'Tutor / Instructor: Date: 06/02/2026',
].join('\n'));

const b = await puppeteer.launch({ headless: true });
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
async function generate(p) {
  await p.click('.sticky-foot .btn');
  await p.waitForFunction(() => document.querySelectorAll('#docscroll .sheet').length > 0, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  return p.$eval('#docscroll', (n) => n.textContent);
}
const clean = (doc) => !/\bNaN\b|undefined|\bnull\b|not applicable progress|not applicable attitude|as not applicable/i.test(doc);

console.log('\n=== Forms export with most answers blank ===');
let p = await fresh();
await upload(p, ['/tmp/fx/partial.csv']);
let sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('file read, nothing skipped', sts[0] === '✓ Read', sts.join(' | '));
let screen = await p.$eval('#screen', (n) => n.textContent);
t('both students found', /2 students found/.test(screen));
await p.click('.frow.clickable');
await p.waitForSelector('.fprev');
let prev = await p.$eval('.fprev', (n) => n.textContent);
t('preview counts the responses', /3 responses · 2 students/.test(prev), prev.slice(0, 120));
t('blank subject filed under General', /filed under General/.test(prev));
t('blank week: current week used', /used the current week/.test(prev));
t('blank week: submission time used where present', /week the form was submitted/.test(prev));
t('blank attendance named, not guessed', /attendance not recorded/.test(prev) && /Attendance not recorded/.test(prev));
t('blank ratings and comments listed', /no ratings given/.test(prev) && /no comments, concerns or actions written/.test(prev));
t('preview says the report still generates', /report still generates/.test(prev));
let doc = await generate(p);
t('reports generated', /Overview|OVERVIEW/.test(doc));
t('no placeholder garbage in the document', clean(doc), (doc.match(/.{30}(NaN|undefined|not applicable).{30}/i) ?? [''])[0]);
t('attendance narrative states what was recorded', /attended \d+ of \d+ weeks|Attendance was not recorded/.test(doc));
t('empty sections say so rather than vanish', /Nothing was recorded in the tutor submissions|No key actions were recorded/.test(doc));
const recents = await p.$$eval('#recents .side-item', (n) => n.map((x) => x.textContent.trim()));
t('two reports in the sidebar', recents.length === 2, recents.join(' | '));
await p.close();

console.log('\n=== Word report with only a name and a subject ===');
p = await fresh();
await upload(p, ['/tmp/fx/partial-word.txt']);
sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('file read', sts[0] === '✓ Read', sts.join(' | '));
await p.click('.frow.clickable');
await p.waitForSelector('.fprev');
prev = await p.$eval('.fprev', (n) => n.textContent);
t('student and subject found', /Sam Placeholder/.test(prev) && /Science/.test(prev));
t('week taken from the sign-off date', /used the date on the document/.test(prev) && /02\/02\/2026|2 Feb|w\/b/.test(prev), prev.slice(0, 200));
t('attendance, ratings and comments listed as blank', /attendance not recorded/.test(prev) && /no ratings given/.test(prev) && /no comments/.test(prev));
doc = await generate(p);
t('report generated from a name and a subject', /Sam/.test(doc) && /Science/i.test(doc));
t('says ratings were not recorded instead of inventing them', /not yet been recorded|have not yet rated|not recorded/i.test(doc));
t('attendance not recorded is stated', /Attendance was not recorded/.test(doc));
t('no placeholder garbage', clean(doc));
await p.close();

console.log('\n=== a row with no name at all is the one thing that is skipped ===');
fs.writeFileSync('/tmp/fx/nameless.csv', 'STUDENT NAME,SUBJECT\n,Mathematics\nAlex Sample,\n');
p = await fresh();
await upload(p, ['/tmp/fx/nameless.csv']);
sts = await p.$$eval('.frow .st', (n) => n.map((x) => x.textContent));
t('file still read (the named row survives)', sts[0] === '✓ Read', sts.join(' | '));
const names = await p.$$eval('.stu-name', (n) => n.map((x) => x.value));
t('exactly one student', names.length === 1 && names[0] === 'Alex Sample', names.join(' | '));
await p.close();

await b.close();
