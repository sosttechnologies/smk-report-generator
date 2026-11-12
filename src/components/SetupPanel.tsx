'use client';

import type { ReportSetup, StudentTerm } from '@/lib/types';

/**
 * The four things the Microsoft Form does not capture: Year/Key Stage, subject tier,
 * average grade, and the term labelling. Prefilled where the dates allow it.
 */
export function SetupPanel({
  term,
  setup,
  onChange,
  disabled,
}: {
  term: StudentTerm;
  setup: ReportSetup;
  onChange: (next: ReportSetup) => void;
  disabled: boolean;
}) {
  const field =
    'w-full rounded border border-[#DCCDB6] bg-white px-2.5 py-1.5 text-[13px] text-[#2A211B] outline-none focus:border-[#B9A68D] disabled:opacity-50';
  const label = 'text-[11px] uppercase tracking-[0.12em] text-[#8A7863]';

  return (
    <details open className="mb-4 rounded-md border border-[#E4D9C6] bg-white px-4 py-3">
      <summary className="cursor-pointer text-xs uppercase tracking-[0.12em] text-[#8A7863]">
        Report details — not captured by the form
      </summary>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className={label}>Year / Key stage</span>
          <input
            className={field}
            disabled={disabled}
            placeholder="KS 4"
            value={setup.year}
            onChange={(e) => onChange({ ...setup, year: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>Academic year</span>
          <input
            className={field}
            disabled={disabled}
            value={setup.academicYear}
            onChange={(e) => onChange({ ...setup, academicYear: e.target.value })}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <span className={label}>Term</span>
          <input
            className={field}
            disabled={disabled}
            value={setup.termLabel}
            onChange={(e) => onChange({ ...setup, termLabel: e.target.value })}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <span className={label}>Reporting date</span>
          <input
            className={field}
            disabled={disabled}
            value={setup.reportingDateLabel}
            onChange={(e) => onChange({ ...setup, reportingDateLabel: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <span className={label}>Tier and average grade per subject</span>
        {term.subjects.map((subject) => (
          <div key={subject.subject} className="grid grid-cols-[1fr_90px_90px] items-center gap-2">
            <span className="text-[13px] text-[#4A3C31]">{subject.subject}</span>
            <input
              className={field}
              disabled={disabled}
              placeholder="Tier"
              value={setup.tiers[subject.subject] ?? ''}
              onChange={(e) =>
                onChange({ ...setup, tiers: { ...setup.tiers, [subject.subject]: e.target.value } })
              }
            />
            <input
              className={field}
              disabled={disabled}
              placeholder="n/a"
              value={setup.averageGrades[subject.subject] ?? ''}
              onChange={(e) =>
                onChange({
                  ...setup,
                  averageGrades: { ...setup.averageGrades, [subject.subject]: e.target.value },
                })
              }
            />
          </div>
        ))}
      </div>
    </details>
  );
}
