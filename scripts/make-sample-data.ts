/**
 * Generates a trial Microsoft Forms export for the demo.
 *
 * ALL DATA HERE IS INVENTED. No real SIEVEMK student, tutor or comment appears in this
 * repository. The column headers mirror what Microsoft Forms produces so the parser is
 * exercised against the real shape.
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { ACADEMIC_ROWS, ENGAGEMENT_ROWS } from '../src/lib/types';

type R = 'Excellent' | 'Good' | 'Average' | 'Poor' | 'Not applicable';
type Att = '100% WEEKLY ATTENDANCE' | '0% WEEKLY ATTENDANCE' | 'ABSENT ON SOME DAY/S DURING THE WEEK';

interface Spec {
  student: string;
  subject: string;
  tutor: string;
  /** One entry per week, in order. */
  weeks: {
    attendance: Att;
    engagement: [R, R, R, R];
    academics: [R, R, R, R, R];
    concerns: string;
    keyActions: string;
    comments: string;
  }[];
}

const WEEK_STARTS = ['04/05/2026', '11/05/2026', '18/05/2026', '25/05/2026', '01/06/2026', '08/06/2026'];

const E: R = 'Excellent';
const G: R = 'Good';
const A: R = 'Average';
const P: R = 'Poor';

const FULL: Att = '100% WEEKLY ATTENDANCE';
const PART: Att = 'ABSENT ON SOME DAY/S DURING THE WEEK';

const SPECS: Spec[] = [
  {
    student: 'George Holmes',
    subject: 'Maths',
    tutor: 'R. Adeyemi',
    weeks: [
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, G, E, A, E],
        concerns: 'Limited resilience when faced with challenging algebra questions; gives up quickly on multi-step problems.',
        keyActions: 'Set three short practice questions between sessions to build persistence.',
        comments: 'Strong participation and engagement in lessons. Grasps new concepts quickly when they are introduced visually.' },
      { attendance: FULL, engagement: [E, G, E, A], academics: [G, E, E, G, E],
        concerns: 'Homework completion inconsistent this week.',
        keyActions: 'Agree a fixed homework slot with family.',
        comments: 'Secure on surds and index laws. Asked thoughtful questions about geometric proof.' },
      { attendance: FULL, engagement: [E, E, E, G], academics: [E, E, E, G, E],
        concerns: 'Handwriting legibility continues to affect marking of working out.',
        keyActions: 'Practise setting out working in a structured format.',
        comments: 'Excellent session. Confident across most of all topics covered so far this term.' },
      { attendance: PART, engagement: [G, A, G, A], academics: [G, G, G, A, G],
        concerns: 'Fluctuating energy levels and frequent fatigue, noticeably lower engagement in the morning session.',
        keyActions: 'Review session timing with family.',
        comments: 'Still contributing well despite tiredness. Good recall of previous content.' },
      { attendance: FULL, engagement: [E, E, E, G], academics: [E, E, E, G, E],
        concerns: 'Inconsistent independent revision between sessions.',
        keyActions: 'Introduce a weekly retrieval quiz.',
        comments: 'Very strong week. Applied algebra confidently to unfamiliar geometry questions.' },
      { attendance: FULL, engagement: [E, E, E, E], academics: [E, E, E, G, E],
        concerns: 'Needs to maintain pace under timed conditions.',
        keyActions: 'Begin timed topic tests next term.',
        comments: 'Excellent attitude throughout. Most of all topics now secure.' },
    ],
  },
  {
    student: 'George Holmes',
    subject: 'English Language',
    tutor: 'A. Bello',
    weeks: [
      { attendance: FULL, engagement: [E, A, G, A], academics: [A, G, G, A, G],
        concerns: 'Punctuality — arrived fifteen minutes late. Homework not submitted.',
        keyActions: 'Set a reminder the evening before each session.',
        comments: 'Positive attitude towards learning and good social skills with peers in the group.' },
      { attendance: FULL, engagement: [E, A, G, G], academics: [G, G, G, A, E],
        concerns: 'Proofreading habits and attention to detail; SPaG errors recur in redrafts.',
        keyActions: 'Introduce a structured proofreading checklist.',
        comments: 'Increasing confidence in creative writing. Responds very well to structured guidance and feedback.' },
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, E, E, G, E],
        concerns: 'Reading speed when tackling longer unseen texts.',
        keyActions: 'Ten minutes independent reading daily.',
        comments: 'Much improvement in deliberate use of language techniques. Strong curiosity and willingness to ask questions.' },
      { attendance: PART, engagement: [G, A, G, A], academics: [A, G, G, A, G],
        concerns: 'Flexibility when responding to unfamiliar exam questions and perspectives.',
        keyActions: 'Practise one unseen extract per week.',
        comments: 'Demonstrates resilience when facing academic challenges even on a tired week.' },
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, E, E, G, E],
        concerns: 'Technical vocabulary when analysing language features.',
        keyActions: 'Build a personal glossary of analytical terms.',
        comments: 'Sensitive and creative writing this week. Becoming more willing to tackle challenging tasks.' },
      { attendance: FULL, engagement: [E, G, E, E], academics: [E, E, E, G, E],
        concerns: 'Continue developing fuller paragraphs in analytical responses.',
        keyActions: 'Apply the point-evidence-analysis structure independently.',
        comments: 'Excellent engagement. Confidence in analytical writing has grown markedly across the term.' },
    ],
  },
  {
    student: 'George Holmes',
    subject: 'Sciences',
    tutor: 'J. Mensah',
    weeks: [
      { attendance: FULL, engagement: [E, A, G, A], academics: [A, G, G, A, G],
        concerns: 'Punctuality and time management. Homework completion inconsistent.',
        keyActions: 'Agree a consistent routine for arriving on time.',
        comments: 'Maintains positive attendance and commitment to lessons. Enthusiastic about Physics, particularly aviation and aircraft.' },
      { attendance: FULL, engagement: [E, G, G, A], academics: [A, G, G, A, G],
        concerns: 'Answers are too generalised and lack sufficient depth; surface-level recall rather than deeper understanding.',
        keyActions: 'Use question-led revision to deepen understanding.',
        comments: 'Regularly asks thought-provoking questions and demonstrates a strong desire to learn.' },
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, G, E, A, E],
        concerns: 'Poor use of scientific vocabulary in written answers. Formulae retention inconsistent.',
        keyActions: 'Practise retrieval of key formulae each session.',
        comments: 'Made notable progress in Electricity. Shows strong understanding when concepts are revisited and consolidated.' },
      { attendance: PART, engagement: [G, A, G, A], academics: [A, A, G, A, G],
        concerns: 'Fatigue, particularly in the mornings, attributed to sleep difficulties and medication side effects.',
        keyActions: 'Keep sessions practical and active where possible.',
        comments: 'Still engaged despite tiredness. Good social conduct and shares positive experiences about family life.' },
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, G, E, G, E],
        concerns: 'Application of knowledge to unfamiliar and examination-style questions.',
        keyActions: 'Complete topic-based past paper questions weekly.',
        comments: 'Performed well in mock examination assessments. Responds well to structured revision and reinforcement activities.' },
      { attendance: FULL, engagement: [E, G, E, G], academics: [G, E, E, G, E],
        concerns: 'Presentation and legibility of written work remains a recurring concern. Needs independent revision habits to reduce repeated revisiting of topics.',
        keyActions: 'Establish short independent revision sessions between lessons.',
        comments: 'Strong engagement and understanding when studying Nuclear Physics. Notable progress in Electricity, Mechanics and Nuclear Physics topics.' },
    ],
  },
  {
    student: 'Amara Okafor',
    subject: 'English Language',
    tutor: 'A. Bello',
    weeks: [
      { attendance: FULL, engagement: [E, E, E, E], academics: [E, E, E, G, E],
        concerns: 'Occasionally repetitive sentence structure.',
        keyActions: 'Experiment with varied sentence openings.',
        comments: 'Excellent comprehension and confident contribution to group discussion.' },
      { attendance: FULL, engagement: [E, E, E, E], academics: [E, E, E, E, E],
        concerns: 'None this week.',
        keyActions: 'Extend into comparative analysis.',
        comments: 'Reads widely and brings a strong vocabulary to written work.' },
      { attendance: FULL, engagement: [E, E, E, G], academics: [E, E, E, G, E],
        concerns: 'Handwriting and presentation under time pressure.',
        keyActions: 'Practise timed paragraphs.',
        comments: 'Thoughtful and well-structured creative writing.' },
      { attendance: FULL, engagement: [E, E, E, E], academics: [E, E, E, E, E],
        concerns: 'None identified.',
        keyActions: 'Begin independent wider reading log.',
        comments: 'Confident, articulate and supportive of peers in discussion.' },
    ],
  },
  {
    student: 'Amara Okafor',
    subject: 'Maths',
    tutor: 'R. Adeyemi',
    weeks: [
      { attendance: FULL, engagement: [E, E, G, G], academics: [G, G, E, G, E],
        concerns: 'Does not always show working on multi-step problems.',
        keyActions: 'Insist on written method for every multi-step question.',
        comments: 'Quick and accurate with number work and fractions.' },
      { attendance: FULL, engagement: [E, E, G, G], academics: [G, G, E, G, E],
        concerns: 'Working out still skipped when confident.',
        keyActions: 'Model full method on the board each session.',
        comments: 'Secure times tables and strong mental arithmetic.' },
      { attendance: FULL, engagement: [E, E, E, G], academics: [G, E, E, G, E],
        concerns: 'Word problems require careful re-reading.',
        keyActions: 'Underline key information before solving.',
        comments: 'Growing confidence with ratio and proportion.' },
      { attendance: FULL, engagement: [E, E, E, E], academics: [E, E, E, G, E],
        concerns: 'None significant.',
        keyActions: 'Introduce extension problems.',
        comments: 'Excellent focus and a positive influence in the group.' },
    ],
  },
  {
    student: 'Daniel Kamara',
    subject: 'Maths',
    tutor: 'R. Adeyemi',
    weeks: [
      { attendance: PART, engagement: [A, A, A, P], academics: [P, A, A, P, A],
        concerns: 'Attendance and homework completion are the main barriers to progress.',
        keyActions: 'Contact family to agree an attendance plan.',
        comments: 'Works carefully when present; improved accuracy in geometry.' },
      { attendance: FULL, engagement: [G, A, G, A], academics: [A, G, G, A, G],
        concerns: 'Homework completion still inconsistent.',
        keyActions: 'Shorter, more frequent homework tasks.',
        comments: 'Noticeably more settled this week and willing to ask for help.' },
      { attendance: PART, engagement: [A, A, A, P], academics: [P, A, A, P, A],
        concerns: 'Missed two sessions; gaps now showing in algebra.',
        keyActions: 'Plan a catch-up session on algebraic manipulation.',
        comments: 'Positive attitude when he does attend.' },
      { attendance: FULL, engagement: [G, G, G, A], academics: [A, G, G, A, G],
        concerns: 'Needs to build independent revision habits.',
        keyActions: 'Provide a structured revision checklist.',
        comments: 'Good progress on geometry. Responding well to one-to-one explanation.' },
    ],
  },
  {
    student: 'Daniel Kamara',
    subject: 'English Language',
    tutor: 'A. Bello',
    weeks: [
      { attendance: PART, engagement: [A, A, A, P], academics: [P, A, A, P, A],
        concerns: 'Quotation analysis for literature remains underdeveloped.',
        keyActions: 'Work through a model analytical paragraph together.',
        comments: 'Thoughtful creative writing with a strong personal voice.' },
      { attendance: FULL, engagement: [G, G, G, A], academics: [A, G, A, A, G],
        concerns: 'Reluctant to contribute in whole-group discussion.',
        keyActions: 'Use paired discussion before whole-group feedback.',
        comments: 'Engaged well with the extract and made a perceptive point about character.' },
      { attendance: PART, engagement: [A, A, A, P], academics: [P, A, A, P, A],
        concerns: 'Absence is affecting continuity of the literature unit.',
        keyActions: 'Share session notes after each absence.',
        comments: 'Keen to catch up when he returns.' },
      { attendance: FULL, engagement: [G, G, G, G], academics: [A, G, G, A, G],
        concerns: 'Needs to develop paragraphs more fully.',
        keyActions: 'Apply a paragraph structure scaffold.',
        comments: 'Best session of the term. Confident, focused and contributing readily.' },
    ],
  },
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SMK Report Generator — sample data (invented)';
  const sheet = workbook.addWorksheet('Form1');

  const headers = [
    'ID',
    'Start time',
    'Completion time',
    'Email',
    'Name',
    'STUDENT NAME',
    'INSTRUCTURE NAME',
    'SUBJECT',
    'REPORTING WEEK ( WEEK BEGINNING)',
    'WEEKLY ATTENDANCE',
    ...ENGAGEMENT_ROWS.map((r) => `STUDENT ENGAGEMENT [${r}]`),
    ...ACADEMIC_ROWS.map((r) => `ACADEMICS [${r}]`),
    'CONCERNS',
    'KEY ACTIONS',
    'GENERAL COMMENTS',
  ];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  let id = 1;
  for (const spec of SPECS) {
    spec.weeks.forEach((week, i) => {
      const weekStart = WEEK_STARTS[i];
      // Tutors submit at the end of the week they are reporting on.
      const [d, m, y] = weekStart.split('/').map(Number);
      const submitted = new Date(Date.UTC(y, m - 1, d + 4, 16, 30));
      sheet.addRow([
        id++,
        submitted.toISOString(),
        submitted.toISOString(),
        `${spec.tutor.replace(/[^a-z]/gi, '').toLowerCase()}@sievemk.org.uk`,
        spec.tutor,
        spec.student,
        spec.tutor,
        spec.subject,
        weekStart,
        week.attendance,
        ...week.engagement,
        ...week.academics,
        week.concerns,
        week.keyActions,
        week.comments,
      ]);
    });
  }

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const out = path.join(process.cwd(), 'sample-data', 'smk-progress-forms-spring-2026.xlsx');
  await workbook.xlsx.writeFile(out);
  const rows = SPECS.reduce((n, s) => n + s.weeks.length, 0);
  console.log(`Wrote ${rows} submissions across ${new Set(SPECS.map((s) => s.student)).size} students`);
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
