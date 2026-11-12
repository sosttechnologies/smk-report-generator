'use client';

/**
 * The Interim Termly Report document.
 *
 * Page order and section names mirror docs/reference/report-*.png exactly — see
 * .claude/skills/smk-report-format/SKILL.md before changing anything here.
 */

import { subjectWithTier } from '@/lib/report';
import type { GeneratedContent, MatrixRow, ReportDoc } from '@/lib/types';
import { EditableList } from './EditableList';
import { EditableText } from './EditableText';
import { ReportPage } from './ReportPage';

const ATTENDANCE_WORD: Record<string, string> = {
  full: 'Full attendance',
  partial: 'Some absence',
  none: 'Absent',
};

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export interface ReportDocumentProps {
  report: ReportDoc;
  readOnly: boolean;
  onChange: (next: ReportDoc) => void;
  /** Omits the inline logo/footer; Puppeteer repeats them on every physical page. */
  printMode?: boolean;
}

export function ReportDocument({ report, readOnly, onChange, printMode = false }: ReportDocumentProps) {
  const { setup, content, matrix, attendance } = report;

  const setContent = (patch: Partial<GeneratedContent>) =>
    onChange({ ...report, content: { ...content, ...patch } });

  const setMatrixCell = (index: number, patch: Partial<MatrixRow>) =>
    onChange({
      ...report,
      matrix: matrix.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });

  const subjects = matrix.map((row) => row.subject);

  /** Renders per-subject bullet groups, as SUCCESSES and CHALLENGES do in the reference. */
  const subjectBullets = (
    source: Record<string, string[]>,
    key: 'successes' | 'challenges',
  ) =>
    subjects.map((subject) => (
      <div key={subject}>
        <div className="subject-heading">{subject.toUpperCase()}</div>
        <EditableList
          ariaLabel={`${key} for ${subject}`}
          readOnly={readOnly}
          items={source[subject] ?? []}
          onChange={(items) => setContent({ [key]: { ...source, [subject]: items } } as Partial<GeneratedContent>)}
        />
      </div>
    ));

  return (
    <div className="report-doc">
      {/* ---------- Page 1: header block and overview ---------- */}
      <ReportPage printMode={printMode}>
        <div className="report-title">
          <div>INTERIM TERMLY REPORT</div>
          <div>REPORTING DATE: {setup.reportingDateLabel}</div>
        </div>

        <div className="report-meta">
          <div>STUDENT: {report.studentName.toUpperCase()}</div>
          <div>YEAR: {setup.year || '—'}</div>
          <div>ACADEMIC YEAR: {setup.academicYear}</div>
          <div>TERM: {setup.termLabel}</div>
        </div>

        <div className="report-section-label">OVERVIEW</div>
        <EditableText
          ariaLabel="Overview"
          readOnly={readOnly}
          value={content.overview}
          onChange={(overview) => setContent({ overview })}
        />
      </ReportPage>

      {/* ---------- Page 2: the subject matrix ---------- */}
      <ReportPage printMode={printMode}>
        <table className="matrix">
          <thead>
            <tr>
              <th>Subject and Tier</th>
              <th>Attitude To Learning</th>
              <th>Behaviour For Learning</th>
              <th>Contribution In Lessons</th>
              <th>Curriculum Strengths</th>
              <th>Curriculum Areas For Development</th>
              <th>Average score/grade on tests and mocks</th>
              <th>Tutor Assessed Progress</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={row.subject}>
                <td>{subjectWithTier(row.subject, row.tier)}</td>
                <td>
                  <EditableText
                    ariaLabel={`Attitude to learning, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.attitudeToLearning}
                    onChange={(attitudeToLearning) => setMatrixCell(i, { attitudeToLearning })}
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Behaviour for learning, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.behaviourForLearning}
                    onChange={(behaviourForLearning) => setMatrixCell(i, { behaviourForLearning })}
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Contribution in lessons, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.contributionInLessons}
                    onChange={(contributionInLessons) => setMatrixCell(i, { contributionInLessons })}
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Curriculum strengths, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.curriculumStrengths}
                    onChange={(curriculumStrengths) => setMatrixCell(i, { curriculumStrengths })}
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Curriculum areas for development, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.curriculumAreasForDevelopment}
                    onChange={(curriculumAreasForDevelopment) =>
                      setMatrixCell(i, { curriculumAreasForDevelopment })
                    }
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Average grade, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.averageGrade}
                    onChange={(averageGrade) => setMatrixCell(i, { averageGrade })}
                  />
                </td>
                <td>
                  <EditableText
                    ariaLabel={`Tutor assessed progress, ${row.subject}`}
                    readOnly={readOnly}
                    value={row.tutorAssessedProgress}
                    onChange={(tutorAssessedProgress) => setMatrixCell(i, { tutorAssessedProgress })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportPage>

      {/* ---------- Page 3: attendance and cognition ---------- */}
      <ReportPage printMode={printMode}>
        <table className="detail">
          <tbody>
            <tr>
              <td className="detail-label">Attendance</td>
              <td>
                <EditableText
                  ariaLabel="Attendance narrative"
                  readOnly={readOnly}
                  value={content.attendanceNarrative}
                  onChange={(attendanceNarrative) => setContent({ attendanceNarrative })}
                />
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>Week beginning</th>
                      <th>Subjects</th>
                      <th>Attendance</th>
                      <th>Punctuality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.summary.map((week) => (
                      <tr key={week.weekBeginning}>
                        <td>{formatWeek(week.weekBeginning)}</td>
                        <td>{week.subjects.join(', ')}</td>
                        <td>{ATTENDANCE_WORD[week.attendance]}</td>
                        <td>{week.punctuality ?? '—'}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td colSpan={2}>
                        <strong>
                          {attendance.fullWeeks} of {attendance.distinctWeeks} weeks in full
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td className="detail-label">Cognition and Learning</td>
              <td>
                <EditableText
                  ariaLabel="Cognition and learning"
                  readOnly={readOnly}
                  value={content.cognitionAndLearning}
                  onChange={(cognitionAndLearning) => setContent({ cognitionAndLearning })}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </ReportPage>

      {/* ---------- Page 4: successes and challenges ---------- */}
      <ReportPage printMode={printMode}>
        <table className="detail">
          <tbody>
            <tr>
              <td className="detail-label">Successes and Achievements</td>
              <td>{subjectBullets(content.successes, 'successes')}</td>
            </tr>
            <tr>
              <td className="detail-label">Challenges or Concerns</td>
              <td>{subjectBullets(content.challenges, 'challenges')}</td>
            </tr>
          </tbody>
        </table>
      </ReportPage>

      {/* ---------- Page 5: targets and the three observation sections ---------- */}
      <ReportPage printMode={printMode}>
        <table className="detail">
          <tbody>
            <tr>
              <td className="detail-label">Targets or Goals</td>
              <td>
                <EditableList
                  ariaLabel="Targets or goals"
                  readOnly={readOnly}
                  items={content.targets}
                  onChange={(targets) => setContent({ targets })}
                />
              </td>
            </tr>
            <tr>
              <td className="detail-label">Communication and Interaction</td>
              <td>
                <EditableText
                  ariaLabel="Communication and interaction"
                  readOnly={readOnly}
                  value={content.communicationAndInteraction}
                  onChange={(communicationAndInteraction) => setContent({ communicationAndInteraction })}
                />
              </td>
            </tr>
            <tr>
              <td className="detail-label">Social, Emotional and Mental Health</td>
              <td>
                <EditableText
                  ariaLabel="Social, emotional and mental health"
                  readOnly={readOnly}
                  value={content.socialEmotionalMentalHealth}
                  onChange={(socialEmotionalMentalHealth) => setContent({ socialEmotionalMentalHealth })}
                />
              </td>
            </tr>
            <tr>
              <td className="detail-label">Sensory and/or Physical Observations</td>
              <td>
                <EditableText
                  ariaLabel="Sensory and physical observations"
                  readOnly={readOnly}
                  value={content.sensoryPhysical}
                  onChange={(sensoryPhysical) => setContent({ sensoryPhysical })}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </ReportPage>
    </div>
  );
}
