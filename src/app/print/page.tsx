'use client';

import { useEffect, useState } from 'react';
import { ReportDocument } from '@/components/report/ReportDocument';
import type { ReportDoc } from '@/lib/types';
import '@/styles/report.css';

/**
 * Bare printable route. Puppeteer loads it, calls window.__setReport(doc), then waits
 * for #report-ready before printing. Keeping the render here means the PDF and the
 * on-screen document come from exactly the same components.
 */
export default function PrintPage() {
  const [report, setReport] = useState<ReportDoc | null>(null);

  useEffect(() => {
    (window as unknown as { __setReport: (doc: ReportDoc) => void }).__setReport = setReport;
    (window as unknown as { __printReady: boolean }).__printReady = true;
  }, []);

  if (!report) return <div id="report-waiting" />;

  return (
    <>
      <ReportDocument report={report} readOnly printMode onChange={() => {}} />
      <div id="report-ready" />
    </>
  );
}
