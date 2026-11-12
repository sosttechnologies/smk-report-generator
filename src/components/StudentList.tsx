'use client';

import type { ReportStatus, StudentTerm } from '@/lib/types';

const PILL: Record<ReportStatus, { label: string; bg: string; fg: string }> = {
  none: { label: 'Forms in', bg: '#E5D8C4', fg: '#5C4C3F' },
  generating: { label: 'Drafting…', bg: '#E5D8C4', fg: '#5C4C3F' },
  draft: { label: 'Needs review', bg: '#F4E7C9', fg: '#6B4F1D' },
  approved: { label: 'Approved', bg: '#2A211B', fg: '#F2E9DC' },
  exported: { label: 'Exported', bg: '#2A211B', fg: '#F2E9DC' },
};

export function StudentList({
  terms,
  selectedId,
  statuses,
  onSelect,
}: {
  terms: StudentTerm[];
  selectedId: string;
  statuses: Record<string, ReportStatus>;
  onSelect: (id: string) => void;
}) {
  const approved = terms.filter((t) => ['approved', 'exported'].includes(statuses[t.id] ?? 'none')).length;

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-[#DCCDB6] bg-[#EFE4D3]">
      <div className="px-[22px] pb-2 pt-5 text-xs uppercase tracking-[0.24em] text-[#8A7863]">
        Students
      </div>
      <div className="px-[22px] pb-3 text-[13px] text-[#8A7863]">
        {approved} of {terms.length} reports approved
      </div>
      <div className="flex-1 overflow-auto">
        {terms.map((term) => {
          const status = statuses[term.id] ?? 'none';
          const pill = PILL[status];
          const on = term.id === selectedId;
          return (
            <button
              key={term.id}
              onClick={() => onSelect(term.id)}
              style={{ borderLeftColor: on ? '#2A211B' : 'transparent' }}
              className={`flex w-full flex-col gap-1.5 border-l-[3px] px-[22px] py-3.5 text-left transition-colors ${
                on ? 'bg-[#FBF7F0]' : 'hover:bg-[#F6EEE2]'
              }`}
            >
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-base text-[#2A211B]">{term.studentName}</span>
                <span className="text-xs text-[#8A7863]">
                  {term.subjects.length} subj
                </span>
              </div>
              <span
                className="self-start rounded-full px-2.5 py-[3px] text-[11px] uppercase tracking-[0.12em]"
                style={{ background: pill.bg, color: pill.fg }}
              >
                {pill.label}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
