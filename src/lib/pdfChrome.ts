/**
 * The logo header and letterhead footer Puppeteer stamps on every physical page.
 *
 * These run in an isolated context inside Chrome's print pipeline: no external CSS,
 * no relative URLs, and the default font-size is tiny — hence the inline styles and
 * the data-URI logo.
 */

import fs from 'node:fs';
import path from 'node:path';

function logoDataUri(): string {
  const file = path.join(process.cwd(), 'public', 'smk-logo.svg');
  const svg = fs.readFileSync(file, 'utf8');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function headerTemplate(): string {
  return `<div style="width:100%;padding:12px 56px 0;box-sizing:border-box;">
    <img src="${logoDataUri()}" style="width:150px;height:auto;display:block;" />
  </div>`;
}

export function footerTemplate(): string {
  const row =
    'display:flex;justify-content:space-between;gap:16px;font-size:8.5px;color:#1a1a1a;font-family:Carlito,Calibri,sans-serif;';
  const dot = '<span style="color:#c00;">&#9679;</span>';
  return `<div style="width:100%;padding:0 56px 10px;box-sizing:border-box;">
    <div style="${row}">
      <span>${dot} Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR</span>
      <span>${dot} 07908 166 261</span>
      <span>${dot} info@sievemk.org.uk</span>
    </div>
    <div style="text-align:center;margin-top:4px;font-size:8.5px;color:#2b4a7d;font-family:Carlito,Calibri,sans-serif;">
      A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)
    </div>
  </div>`;
}

/** Margins must leave room for the templates above, or Chrome clips them. */
export const PDF_MARGINS = { top: '96px', bottom: '72px', left: '0px', right: '0px' };
