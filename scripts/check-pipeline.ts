/** Smoke test: parse the sample export and print the aggregates. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseUpload } from '../src/lib/parse';
import { aggregateSubmissions, academicYearLabel, reportingDateLabel, termLabel } from '../src/lib/aggregate';

const file = process.argv[2] ?? 'sample-data/smk-progress-forms-spring-2026.xlsx';

async function main() {
  const buf = await fs.readFile(path.join(process.cwd(), file));
  const { submissions, issues, unmappedHeaders } = await parseUpload(file, buf);

  console.log(`Parsed ${submissions.length} submissions`);
  if (unmappedHeaders.length) console.log('Unmapped headers:', unmappedHeaders);
  if (issues.length) console.log('Issues:', issues);

  for (const term of aggregateSubmissions(submissions)) {
    console.log(`\n=== ${term.studentName} (${term.id}) ===`);
    console.log(`  ${reportingDateLabel(term.firstWeek, term.lastWeek)} | ${academicYearLabel(term.firstWeek)} | ${termLabel(term.firstWeek, term.lastWeek)}`);
    const a = term.attendance;
    console.log(`  Attendance: ${a.fullWeeks} full / ${a.partialWeeks} partial / ${a.absentWeeks} absent of ${a.distinctWeeks} weeks; punctuality ${a.modalPunctuality}`);
    for (const s of term.subjects) {
      console.log(
        `  ${s.subject.padEnd(18)} wks=${s.weekCount} ATL=${s.attitudeToLearning.padEnd(9)} BFL=${s.behaviourForLearning.padEnd(9)} CIL=${s.contributionInLessons.padEnd(9)} progress=${s.tutorAssessedProgress}`,
      );
      console.log(`      tutors=${s.instructors.join(', ')} comments=${s.generalComments.length} concerns=${s.concerns.length} actions=${s.keyActions.length}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
