import type { ReactNode } from 'react';
import { ReportFooter } from './ReportFooter';

/**
 * One section of the report.
 *
 * On screen it looks like a sheet of A4 with the logo and letterhead footer, so staff
 * see the real document. In print mode both are omitted: Puppeteer draws them as a
 * repeating header/footer on EVERY physical page, which is the only way they survive a
 * section that overflows onto a second page.
 */
export function ReportPage({
  children,
  printMode = false,
}: {
  children: ReactNode;
  printMode?: boolean;
}) {
  if (printMode) {
    return <section className="report-page report-page--flow">{children}</section>;
  }

  return (
    <section className="report-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/smk-logo.svg" alt="SMK Gateway" className="report-logo" />
      {children}
      <ReportFooter />
    </section>
  );
}
