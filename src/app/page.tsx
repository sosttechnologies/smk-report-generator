'use client';

import { useCallback, useMemo, useState } from 'react';
import { ReportDocument } from '@/components/report/ReportDocument';
import { SetupPanel } from '@/components/SetupPanel';
import { StudentList } from '@/components/StudentList';
import { SubmissionsPanel } from '@/components/SubmissionsPanel';
import { UploadPanel, type UploadOutcome } from '@/components/UploadPanel';
import { defaultSetup } from '@/lib/report';
import type { ReportDoc, ReportSetup, ReportStatus, StudentTerm } from '@/lib/types';
import '@/styles/report.css';

interface Loaded {
  terms: StudentTerm[];
  method: 'spreadsheet' | 'document';
  notes: string[];
  issues: { row: number; field: string; message: string }[];
  filename: string;
  submissionCount: number;
}

const DOC_STATUS: Record<ReportStatus, string> = {
  none: 'No draft',
  generating: 'Drafting from tutor submissions…',
  draft: 'Draft · edit any section, then approve',
  approved: 'Approved · ready to export',
  exported: 'Exported to letterhead PDF',
};

export default function Workspace() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [setups, setSetups] = useState<Record<string, ReportSetup>>({});
  const [reports, setReports] = useState<Record<string, ReportDoc>>({});
  const [statuses, setStatuses] = useState<Record<string, ReportStatus>>({});
  const [toast, setToast] = useState('');
  const [note, setNote] = useState('');

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3200);
  }, []);

  const onLoaded = (result: UploadOutcome) => {
    const terms = result.terms as StudentTerm[];
    setLoaded({
      terms,
      method: result.method,
      notes: result.notes ?? [],
      issues: result.issues ?? [],
      filename: result.filename,
      submissionCount: result.submissionCount,
    });
    setSelectedId(terms[0]?.id ?? '');
    setSetups(Object.fromEntries(terms.map((t) => [t.id, defaultSetup(t)])));
  };

  const term = useMemo(
    () => loaded?.terms.find((t) => t.id === selectedId),
    [loaded, selectedId],
  );

  if (!loaded || !term) return <UploadPanel onLoaded={onLoaded} />;

  const status = statuses[selectedId] ?? 'none';
  const report = reports[selectedId];
  const setup = setups[selectedId];
  const locked = status === 'approved' || status === 'exported';

  const setStatus = (next: ReportStatus) => setStatuses((s) => ({ ...s, [selectedId]: next }));

  async function generate() {
    setStatus('generating');
    setNote('');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, setup }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus('none');
        flash(data.error ?? 'Generation failed');
        return;
      }
      setReports((r) => ({ ...r, [selectedId]: data.report }));
      setStatus('draft');
      if (data.note) setNote(data.note);
    } catch {
      setStatus('none');
      flash('Could not reach the server.');
    }
  }

  async function exportPdf() {
    if (!report) return;
    flash('Rendering PDF…');
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        flash(data.error ?? 'Export failed');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.studentName} — ${setup.termLabel.split(' (')[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('exported');
      flash(`Exported ${a.download}`);
    } catch {
      flash('Could not reach the server.');
    }
  }

  const btn =
    'rounded px-[18px] py-2.5 text-[13px] uppercase tracking-[0.1em] transition-colors disabled:opacity-45';

  return (
    <div className="flex min-h-screen flex-col bg-[#F2E9DC] text-[#2A211B]">
      <header className="flex flex-wrap items-center justify-between gap-6 bg-[#2A211B] px-7 py-4 text-[#F2E9DC]">
        <div className="flex items-baseline gap-[18px]">
          <span className="font-display text-[28px] tracking-[0.12em]">SIEVEMK</span>
          <span className="text-[13px] uppercase tracking-[0.24em] text-[#A99884]">
            Termly reports
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm text-[#C0B09B]">
          <span>
            {loaded.filename} · {loaded.submissionCount} submissions
          </span>
          <button
            onClick={() => {
              setLoaded(null);
              setReports({});
              setStatuses({});
            }}
            className="rounded border border-[#4A3C31] px-3 py-1.5 text-xs uppercase tracking-[0.1em] hover:bg-[#3D3128]"
          >
            New upload
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-wrap items-stretch">
        <StudentList
          terms={loaded.terms}
          selectedId={selectedId}
          statuses={statuses}
          onSelect={setSelectedId}
        />

        <SubmissionsPanel term={term} method={loaded.method}>
          <SetupPanel
            term={term}
            setup={setup}
            onChange={(next) => setSetups((s) => ({ ...s, [selectedId]: next }))}
            disabled={locked || status === 'generating'}
          />
          <button
            onClick={generate}
            disabled={status === 'generating' || locked}
            className="w-full rounded bg-[#2A211B] px-5 py-3.5 text-sm uppercase tracking-[0.12em] text-[#F2E9DC] transition-colors hover:bg-[#3D3128] disabled:opacity-45"
          >
            {status === 'generating'
              ? 'Drafting report…'
              : report
                ? 'Redraft whole report'
                : 'Generate termly report'}
          </button>
        </SubmissionsPanel>

        <main className="flex min-w-0 flex-[2_1_520px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#DCCDB6] bg-[#F2E9DC] px-7 py-3.5">
            <span className="text-xs uppercase tracking-[0.24em] text-[#8A7863]">
              {DOC_STATUS[status]}
            </span>
            <div className="flex flex-wrap gap-2.5">
              {status === 'draft' && (
                <button
                  onClick={() => {
                    setStatus('approved');
                    flash(`${term.studentName.split(' ')[0]}'s report approved`);
                  }}
                  className={`${btn} bg-[#2A211B] text-[#F2E9DC] hover:bg-[#3D3128]`}
                >
                  Approve report
                </button>
              )}
              {locked && (
                <>
                  <button
                    onClick={() => setStatus('draft')}
                    className={`${btn} border border-[#B9A68D] hover:bg-[#EBDFCC]`}
                  >
                    Edit again
                  </button>
                  <button
                    onClick={exportPdf}
                    className={`${btn} bg-[#2A211B] text-[#F2E9DC] hover:bg-[#3D3128]`}
                  >
                    Export to letterhead PDF
                  </button>
                </>
              )}
            </div>
          </div>

          {note && (
            <div className="border-b border-[#DCCDB6] bg-[#F4E7C9] px-7 py-2.5 text-[13px] text-[#6B4F1D]">
              {note}
            </div>
          )}

          <div className="flex flex-1 justify-center overflow-auto px-7 py-8">
            {!report ? (
              <div className="flex max-w-sm flex-col gap-3 self-center text-center text-[#8A7863]">
                <div className="font-display text-[34px] text-[#2A211B]">No report yet</div>
                <p className="text-[15px] leading-relaxed">
                  Check {term.studentName.split(' ')[0]}&apos;s submissions on the left, fill in the
                  report details, then generate a draft. Nothing is exported until a member of staff
                  approves it.
                </p>
              </div>
            ) : (
              <ReportDocument
                report={report}
                readOnly={locked}
                onChange={(next) => setReports((r) => ({ ...r, [selectedId]: next }))}
              />
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded bg-[#2A211B] px-[22px] py-3.5 text-sm text-[#F2E9DC] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
