'use client';

import { DERIVATION_NOTES } from '@/lib/aggregate';
import type { StudentTerm } from '@/lib/types';

const ATTENDANCE_WORD: Record<string, string> = {
  full: '100% attendance',
  partial: 'Absent some days',
  none: 'No attendance',
};

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

/** What the tutors actually submitted, grouped by subject then week. */
export function SubmissionsPanel({
  term,
  method,
  children,
}: {
  term: StudentTerm;
  method: 'spreadsheet' | 'document';
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-[320px] max-w-[460px] flex-1 flex-col border-r border-[#DCCDB6] bg-[#FBF7F0]">
      <div className="flex flex-col gap-1 border-b border-[#E4D9C6] px-6 py-5">
        <div className="text-xs uppercase tracking-[0.24em] text-[#8A7863]">
          Tutor submissions
        </div>
        <div className="font-display text-[28px] text-[#2A211B]">{term.studentName}</div>
        <div className="text-[13px] text-[#8A7863]">
          {term.submissions.length} submissions · {term.subjects.length} subjects ·{' '}
          {term.attendance.distinctWeeks} weeks
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-6 py-4">
        {method === 'document' && (
          <div className="rounded bg-[#F4E7C9] px-3 py-2.5 text-[13px] text-[#6B4F1D]">
            Read from a document by Claude. Check these against the original before generating.
          </div>
        )}

        {term.subjects.map((subject) => (
          <div
            key={subject.subject}
            className="rounded-md border border-[#E4D9C6] bg-white px-4 py-3.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-medium text-[#2A211B]">{subject.subject}</span>
              <span className="text-xs text-[#8A7863]">
                {subject.weekCount} weeks · {subject.instructors.join(', ') || 'no tutor'}
              </span>
            </div>

            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#5C4C3F]">
              <dt className="text-[#8A7863]" title={DERIVATION_NOTES.attitudeToLearning}>
                Attitude
              </dt>
              <dd>{subject.attitudeToLearning}</dd>
              <dt className="text-[#8A7863]" title={DERIVATION_NOTES.behaviourForLearning}>
                Behaviour
              </dt>
              <dd>{subject.behaviourForLearning}</dd>
              <dt className="text-[#8A7863]" title={DERIVATION_NOTES.contributionInLessons}>
                Contribution
              </dt>
              <dd>{subject.contributionInLessons}</dd>
              <dt className="text-[#8A7863]" title={DERIVATION_NOTES.tutorAssessedProgress}>
                Progress
              </dt>
              <dd>{subject.tutorAssessedProgress}</dd>
            </dl>

            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-xs uppercase tracking-[0.1em] text-[#8A7863]">
                Weekly comments
              </summary>
              <div className="mt-2 flex flex-col gap-2 leading-relaxed text-[#4A3C31]">
                {subject.generalComments.map((comment, i) => (
                  <p key={i}>
                    <span className="text-[#8A7863]">Comment — </span>
                    {comment}
                  </p>
                ))}
                {subject.concerns.map((concern, i) => (
                  <p key={`c${i}`}>
                    <span className="text-[#8A7863]">Concern — </span>
                    {concern}
                  </p>
                ))}
              </div>
            </details>
          </div>
        ))}

        <div className="mt-1 rounded-md border border-dashed border-[#D6C6B0] px-4 py-3 text-[13px] text-[#5C4C3F]">
          <div className="mb-1.5 text-xs uppercase tracking-[0.1em] text-[#8A7863]">Attendance</div>
          {term.attendance.fullWeeks} of {term.attendance.distinctWeeks} weeks in full
          {term.attendance.partialWeeks > 0 && `, ${term.attendance.partialWeeks} partial`}
          {term.attendance.absentWeeks > 0 && `, ${term.attendance.absentWeeks} missed`}
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-[#8A7863]">
            {term.attendance.weeks.map((week) => (
              <li key={`${week.weekBeginning}-${week.subject}`}>
                {formatWeek(week.weekBeginning)} · {week.subject} ·{' '}
                {week.attendance ? ATTENDANCE_WORD[week.attendance] : 'Attendance not recorded'}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-[#E4D9C6] px-6 py-4">{children}</div>
    </section>
  );
}
