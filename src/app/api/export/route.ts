import puppeteer from 'puppeteer';
import { PDF_MARGINS, footerTemplate, headerTemplate } from '@/lib/pdfChrome';
import type { ReportDoc } from '@/lib/types';

export const maxDuration = 120;

/**
 * Renders the report to an A4 PDF.
 *
 * The body is rendered by the same React components staff edited, loaded in headless
 * Chrome, so the PDF cannot drift from what was approved on screen. The logo and
 * letterhead footer are stamped by Chrome's own print header/footer so they appear on
 * every physical page, including the extra pages a long section flows onto.
 */
export async function POST(request: Request) {
  const { report } = (await request.json()) as { report?: ReportDoc };

  if (!report) {
    return Response.json({ error: 'No report supplied' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/print`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__printReady === true');
    await page.evaluate((doc) => {
      (window as unknown as { __setReport: (d: unknown) => void }).__setReport(doc);
    }, report as unknown as Record<string, unknown>);
    await page.waitForSelector('#report-ready', { timeout: 20000 });
    await page.evaluateHandle('document.fonts.ready');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(),
      footerTemplate: footerTemplate(),
      margin: PDF_MARGINS,
    });

    const filename = `${report.studentName} - ${report.setup.termLabel.split(' (')[0]}.pdf`;
    return new Response(Buffer.from(pdf) as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'PDF render failed' },
      { status: 500 },
    );
  } finally {
    await browser.close();
  }
}
