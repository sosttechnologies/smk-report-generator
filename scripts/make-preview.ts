/**
 * Builds a standalone HTML preview of the generated report + workspace UI.
 * Uses the real output of the pipeline, so the preview cannot drift from the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { aggregateSubmissions } from '../src/lib/aggregate';
import { generateFromTemplate } from '../src/lib/generate/template';
import { parseUpload } from '../src/lib/parse';
import { buildReport, defaultSetup, subjectWithTier } from '../src/lib/report';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const week = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const ATT: Record<string, string> = { full: 'Full attendance', partial: 'Some absence', none: 'Absent' };

async function main() {
  const file = 'sample-data/smk-progress-forms-spring-2026.xlsx';
  const { submissions } = await parseUpload(file, fs.readFileSync(file));
  const terms = aggregateSubmissions(submissions);
  const term = terms.find((t) => t.id === 'alex-sample')!;

  const setup = {
    ...defaultSetup(term),
    year: 'KS 4',
    termLabel: 'SPRING TERM (MAY - JUNE 2026)',
    reportingDateLabel: '4 MAY TO 11 JUNE 2026',
    tiers: { Maths: 'Higher', 'English Language': '', Sciences: 'Higher' },
  };
  const report = buildReport(term, setup, generateFromTemplate(term), true);
  const { content, matrix, attendance } = report;
  const subjects = matrix.map((m) => m.subject);

  const logo = fs.readFileSync('public/smk-logo.svg', 'utf8');
  const logoUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;

  const footer = `<div class="r-footer">
    <div class="r-footer-row">
      <span><i>&#9679;</i> Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR</span>
      <span><i>&#9679;</i> 07908 166 261</span>
      <span><i>&#9679;</i> info@sievemk.org.uk</span>
    </div>
    <div class="r-legal">A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)</div>
  </div>`;

  const page = (inner: string, n: number) =>
    `<figure class="sheet"><div class="sheet-no">Page ${n}</div><div class="paper">
       <img class="r-logo" src="${logoUri}" alt="SMK Gateway">${inner}${footer}
     </div></figure>`;

  const bullets = (items: string[]) =>
    `<ul>${items.filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;

  const perSubject = (src: Record<string, string[]>) =>
    subjects
      .map((s) => `<div class="sub-head">${esc(s.toUpperCase())}</div>${bullets(src[s] ?? [])}`)
      .join('');

  const p1 = `
    <div class="r-title"><div>INTERIM TERMLY REPORT</div><div>REPORTING DATE: ${esc(setup.reportingDateLabel)}</div></div>
    <div class="r-meta">
      <div>STUDENT: ${esc(report.studentName.toUpperCase())}</div>
      <div>YEAR: ${esc(setup.year)}</div>
      <div>ACADEMIC YEAR: ${esc(setup.academicYear)}</div>
      <div>TERM: ${esc(setup.termLabel)}</div>
    </div>
    <div class="r-label">OVERVIEW</div>
    <p>${esc(content.overview)}</p>`;

  const p2 = `<table class="matrix">
    <thead><tr>
      <th>Subject and Tier</th><th>Attitude To Learning</th><th>Behaviour For Learning</th>
      <th>Contribution In Lessons</th><th>Curriculum Strengths</th><th>Curriculum Areas For Development</th>
      <th>Average score/grade on tests and mocks</th><th>Tutor Assessed Progress</th>
    </tr></thead>
    <tbody>${matrix
      .map(
        (r) => `<tr>
          <td>${esc(subjectWithTier(r.subject, r.tier))}</td>
          <td>${esc(r.attitudeToLearning)}</td><td>${esc(r.behaviourForLearning)}</td>
          <td>${esc(r.contributionInLessons)}</td><td>${esc(r.curriculumStrengths)}</td>
          <td>${esc(r.curriculumAreasForDevelopment)}</td><td>${esc(r.averageGrade)}</td>
          <td>${esc(r.tutorAssessedProgress)}</td></tr>`,
      )
      .join('')}</tbody></table>`;

  const p3 = `<table class="detail"><tbody>
    <tr><td class="lab">Attendance</td><td>
      <p>${esc(content.attendanceNarrative)}</p>
      <table class="att"><thead><tr><th>Week beginning</th><th>Subjects</th><th>Attendance</th><th>Punctuality</th></tr></thead>
      <tbody>${attendance.summary
        .map(
          (w) =>
            `<tr><td>${week(w.weekBeginning)}</td><td>${esc(w.subjects.join(', '))}</td><td>${ATT[w.attendance]}</td><td>${w.punctuality ?? '&mdash;'}</td></tr>`,
        )
        .join('')}
      <tr><td colspan="2"><strong>Total</strong></td><td colspan="2"><strong>${attendance.fullWeeks} of ${attendance.distinctWeeks} weeks in full</strong></td></tr>
      </tbody></table>
    </td></tr>
    <tr><td class="lab">Cognition and Learning</td><td>${content.cognitionAndLearning
      .split('\n\n')
      .map((para) => `<p>${esc(para)}</p>`)
      .join('')}</td></tr>
  </tbody></table>`;

  const p4 = `<table class="detail"><tbody>
    <tr><td class="lab">Successes and Achievements</td><td>${perSubject(content.successes)}</td></tr>
    <tr><td class="lab">Challenges or Concerns</td><td>${perSubject(content.challenges)}</td></tr>
  </tbody></table>`;

  const p5 = `<table class="detail"><tbody>
    <tr><td class="lab">Targets or Goals</td><td>${bullets(content.targets)}</td></tr>
    <tr><td class="lab">Communication and Interaction</td><td><p>${esc(content.communicationAndInteraction)}</p></td></tr>
    <tr><td class="lab">Social, Emotional and Mental Health</td><td><p>${esc(content.socialEmotionalMentalHealth)}</p></td></tr>
    <tr><td class="lab">Sensory and/or Physical Observations</td><td><p>${esc(content.sensoryPhysical)}</p></td></tr>
  </tbody></table>`;

  const pages = [p1, p2, p3, p4, p5].map((p, i) => page(p, i + 1)).join('\n');

  const studentRows = terms
    .map((t, i) => {
      const pill = i === 0 ? 'Needs review' : 'Forms in';
      const cls = i === 0 ? 'pill pill-review' : 'pill';
      return `<button class="srow${i === 0 ? ' on' : ''}">
        <span class="srow-top"><span>${esc(t.studentName)}</span><span class="dim">${t.subjects.length} subj</span></span>
        <span class="${cls}">${pill}</span></button>`;
    })
    .join('');

  const subjectCards = term.subjects
    .map(
      (s) => `<div class="card">
        <div class="card-top"><span>${esc(s.subject)}</span><span class="dim">${s.weekCount} weeks · ${esc(s.instructors.join(', '))}</span></div>
        <dl><dt>Attitude</dt><dd>${s.attitudeToLearning}</dd><dt>Behaviour</dt><dd>${s.behaviourForLearning}</dd>
        <dt>Contribution</dt><dd>${s.contributionInLessons}</dd><dt>Progress</dt><dd>${s.tutorAssessedProgress}</dd></dl>
      </div>`,
    )
    .join('');

  const html = `<title>SMK Gateway Report Generator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500&family=Carlito:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{
  --espresso:#2A211B; --espresso-hi:#3D3128; --brown:#4A3C31; --taupe:#8A7863;
  --sand:#EFE4D3; --cream:#F2E9DC; --panel:#FBF7F0; --chip:#E5D8C4;
  --border:#DCCDB6; --border-soft:#E4D9C6; --review-bg:#F4E7C9; --review-fg:#6B4F1D;
  --ink:#2A211B; --ground:#EDE2D0; --surface:#FBF7F0; --muted:#8A7863;
}
:root:not([data-theme="light"]){ @media (prefers-color-scheme: dark){
  --ink:#F2E9DC; --ground:#1A1511; --surface:#241D18; --muted:#A99884;
  --border:#3D3128; --border-soft:#342A23; --cream:#241D18; --sand:#2A211B; --panel:#241D18;
}}
:root[data-theme="dark"]{
  --ink:#F2E9DC; --ground:#1A1511; --surface:#241D18; --muted:#A99884;
  --border:#3D3128; --border-soft:#342A23; --cream:#241D18; --sand:#2A211B; --panel:#241D18;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Jost,ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6}
.wrap{max-width:1180px;margin:0 auto;padding-block:56px 80px;padding-left:20px;padding-right:20px}
h1{font-family:'Cormorant Garamond',ui-serif,Georgia,serif;font-size:clamp(34px,6vw,54px);
  font-weight:400;letter-spacing:.06em;margin:0;text-wrap:balance}
.eyebrow{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.lede{max-width:62ch;color:var(--muted);margin:14px 0 0;font-size:17px}
h2{font-family:'Cormorant Garamond',ui-serif,Georgia,serif;font-size:30px;font-weight:400;
  margin:64px 0 6px;letter-spacing:.02em}
h2 + .sub{color:var(--muted);font-size:14px;margin:0 0 22px;max-width:62ch}
.flow{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:28px}
.step{border:1px solid var(--border);border-radius:6px;padding:14px 15px;background:var(--surface)}
.step b{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:400}
.step span{font-size:14.5px}
.gate{border-left:3px solid var(--espresso);background:var(--review-bg);color:var(--review-fg);
  padding:14px 18px;border-radius:0 5px 5px 0;margin-top:26px;font-size:14.5px}
:root[data-theme="dark"] .gate,:root:not([data-theme="light"]) .gate{}
/* --- app mock --- */
.app{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--panel)}
.app-bar{background:#2A211B;color:#F2E9DC;display:flex;justify-content:space-between;
  align-items:center;gap:20px;padding:13px 22px;flex-wrap:wrap}
.app-bar b{font-family:'Cormorant Garamond',serif;font-size:23px;font-weight:400;letter-spacing:.12em}
.app-bar .t{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A99884}
.app-bar .r{font-size:12px;color:#C0B09B}
.cols{display:grid;grid-template-columns:200px 1fr;min-height:320px}
@media (max-width:720px){.cols{grid-template-columns:1fr}}
.col-a{background:var(--sand);border-right:1px solid var(--border);padding:14px 0}
.col-b{background:var(--panel);padding:16px 18px;display:grid;gap:10px;align-content:start}
.col-a .hd{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);padding:0 16px 8px}
.srow{all:unset;display:flex;flex-direction:column;gap:5px;padding:10px 16px;
  border-left:3px solid transparent;width:100%;box-sizing:border-box;font:inherit;color:var(--ink)}
.srow.on{border-left-color:var(--espresso);background:var(--panel)}
.srow-top{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.dim{color:var(--muted);font-size:11.5px}
.pill{align-self:flex-start;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
  padding:2px 9px;border-radius:999px;background:var(--chip);color:#5C4C3F}
.pill-review{background:var(--review-bg);color:var(--review-fg)}
.card{border:1px solid var(--border-soft);border-radius:6px;background:var(--surface);padding:11px 13px}
.card-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:14px}
.card dl{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2px 8px;margin:8px 0 0;font-size:11.5px}
.card dt{color:var(--muted)} .card dd{margin:0}
.cta{background:#2A211B;color:#F2E9DC;text-align:center;padding:11px;border-radius:4px;
  font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;margin-top:2px}
/* --- the paper --- */
.sheets{display:grid;gap:34px;margin-top:26px;justify-items:center}
.sheet{margin:0;width:100%;max-width:794px}
.sheet-no{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.paper{background:#fff;color:#111;font-family:Carlito,Calibri,sans-serif;font-size:13px;line-height:1.5;
  padding:34px 42px 76px;position:relative;min-height:760px;
  box-shadow:0 18px 44px -26px rgba(0,0,0,.5);border:1px solid rgba(0,0,0,.08);overflow:hidden}
.r-logo{width:132px;display:block;margin-bottom:20px}
.r-title{text-align:center;font-weight:700;font-size:13.5px}
.r-title div + div{margin-top:9px}
.r-meta{margin:30px 0 36px;font-weight:700;font-size:12.5px}
.r-meta div + div{margin-top:9px}
.r-label{font-weight:700;font-size:12.5px;margin-bottom:9px}
.paper p{margin:0 0 9px}
.matrix,.detail,.att{width:100%;border-collapse:collapse;table-layout:fixed}
.matrix th,.matrix td{border:1px solid #111;padding:6px 6px;vertical-align:top;text-align:left;
  font-size:9.6px;line-height:1.35;word-wrap:break-word}
.matrix th{font-weight:700}
.detail td{border:1px solid #111;padding:9px 11px;vertical-align:top;font-size:11.5px;line-height:1.45}
.detail td.lab{width:150px;font-weight:700;text-transform:uppercase}
.detail ul{margin:3px 0 8px;padding-left:18px}
.detail li{margin-bottom:3px}
.sub-head{font-weight:700;margin:8px 0 3px}
.sub-head:first-child{margin-top:0}
.att{margin-top:8px}
.att th,.att td{border:1px solid #555;padding:4px 7px;text-align:left;font-size:10.5px}
.r-footer{position:absolute;left:42px;right:42px;bottom:20px;font-size:8.4px;color:#1a1a1a}
.r-footer-row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.r-footer i{color:#c00;font-style:normal}
.r-legal{text-align:center;margin-top:5px;color:#2b4a7d}
.note{margin-top:46px;border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:13.5px;max-width:70ch}
.note b{color:var(--ink);font-weight:500}
@media (max-width:560px){.paper{padding:20px 16px 70px}.r-footer{left:16px;right:16px}
  .matrix th,.matrix td{font-size:8px;padding:4px 3px}.detail td.lab{width:92px}}
</style>

<div class="wrap">
  <p class="eyebrow">SIEVEMK Gateway &middot; build preview</p>
  <h1>Termly Report Generator</h1>
  <p class="lede">Tutors submit a weekly Microsoft Form per student, per subject. Staff currently
  retype all of it by hand into a six-page Interim Termly Report. This reads the submissions and
  drafts the whole document &mdash; then waits for a human.</p>

  <div class="flow">
    <div class="step"><b>1 &middot; Upload</b><span>Forms export, PDF or Word</span></div>
    <div class="step"><b>2 &middot; Review</b><span>Submissions per subject</span></div>
    <div class="step"><b>3 &middot; Generate</b><span>Every section drafted</span></div>
    <div class="step"><b>4 &middot; Edit</b><span>Any field, inline</span></div>
    <div class="step"><b>5 &middot; Approve</b><span>Required by a person</span></div>
    <div class="step"><b>6 &middot; Export</b><span>Letterhead PDF</span></div>
  </div>

  <div class="gate"><strong>Export is locked until a member of staff clicks Approve.</strong>
  Re-opening an approved report to edit it clears the approval. These are reports about children.</div>

  <h2>The workspace</h2>
  <p class="sub">Students down the left with their report status; the tutor submissions that feed
  the report in the middle, including every derived rating so staff can check it before drafting.</p>
  <div class="app">
    <div class="app-bar"><div style="display:flex;align-items:baseline;gap:14px">
      <b>SIEVEMK</b><span class="t">Termly reports</span></div>
      <span class="r">smk-progress-forms-spring-2026.xlsx &middot; ${submissions.length} submissions</span></div>
    <div class="cols">
      <div class="col-a"><div class="hd">Students</div>${studentRows}</div>
      <div class="col-b">${subjectCards}<div class="cta">Generate termly report</div></div>
    </div>
  </div>

  <h2>The document it produces</h2>
  <p class="sub">Real output from the synthetic sample data &mdash; six weeks across three
  subjects. Below is what exports to PDF, with the letterhead footer on every page.</p>
  <div class="sheets">${pages}</div>

  <p class="note"><b>What you are looking at.</b> Every word below the headings was assembled from
  invented tutor submissions by the offline template generator, so the demo runs with no API key.
  With <code>ANTHROPIC_API_KEY</code> set, Claude writes these sections instead and the prose reads
  far closer to SIEVEMK's own reports. The logo is a placeholder until SMK supply the real asset,
  and Year, tier and average grade are typed in by staff because the current form does not ask for them.</p>
</div>`;

  const out = path.join(process.env.PREVIEW_OUT || '.', 'smk-preview.html');
  fs.writeFileSync(out, html);
  console.log('wrote', out, (html.length / 1024).toFixed(1) + ' KB');
}

main().catch((e) => { console.error(e); process.exit(1); });
