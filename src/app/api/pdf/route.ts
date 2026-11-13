import puppeteer from 'puppeteer';

export const maxDuration = 120;

/**
 * Renders the HTML the UI already builds for download into a real PDF.
 * This is the one thing the browser cannot do for itself, and the reason the
 * deployment needs Chromium.
 */
export async function POST(request: Request) {
  const { html, filename } = (await request.json()) as { html?: string; filename?: string };
  if (!html) return Response.json({ error: 'html is required' }, { status: 400 });

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const name = (filename ?? 'report.pdf').replace(/[^\w.\- ]+/g, '_');
    return new Response(Buffer.from(pdf) as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    });
  } finally {
    await browser.close();
  }
}
