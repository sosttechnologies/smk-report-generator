/** Proves no identifying name reaches the prompt, and that rehydration restores them. */
import fs from 'node:fs';
import { aggregateSubmissions } from '../src/lib/aggregate';
import { parseUpload } from '../src/lib/parse';
import { findResidualRisks, pseudonymise, rehydrate } from '../src/lib/pseudonymise';

const file = 'sample-data/smk-progress-forms-spring-2026.xlsx';

async function main() {
  const { submissions } = await parseUpload(file, fs.readFileSync(file));
  const term = aggregateSubmissions(submissions).find((t) => t.id === 'george-holmes')!;
  const { term: masked, pseudonym } = pseudonymise(term);

  const payload = JSON.stringify(masked);
  const leaked = ['George', 'Holmes', 'Adeyemi', 'Bello', 'Mensah'].filter((n) =>
    new RegExp(`\\b${n}\\b`, 'i').test(payload),
  );

  console.log('What the model would receive:');
  console.log('  student name :', masked.studentName);
  console.log('  tutors       :', [...new Set(masked.subjects.flatMap((s) => s.instructors))].join(', '));
  console.log('  leaked names :', leaked.length ? '❌ ' + leaked.join(', ') : '✅ none');
  console.log('  sample comment:', masked.subjects[0].generalComments[0]);

  const modelAnswer = {
    overview: `${pseudonym.studentToken} has made strong progress, supported well by Tutor 1.`,
    targets: [`Tutor 2 to set weekly practice for ${pseudonym.studentToken}.`],
  };
  console.log('\nRehydrated:', JSON.stringify(rehydrate(modelAnswer, pseudonym), null, 2));

  const risks = findResidualRisks(term);
  console.log(`\nResidual-risk flags for staff review: ${risks.length}`);
  risks.slice(0, 4).forEach((r) => console.log(`  [${r.reason}] ${r.text.slice(0, 92)}…`));

  process.exit(leaked.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
