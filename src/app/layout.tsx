import type { Metadata } from 'next';
import { Cormorant_Garamond, Jost, Carlito } from 'next/font/google';
import './globals.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-display',
});

const ui = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ui',
});

// Carlito is metric-compatible with Calibri, which the real report uses.
const document = Carlito({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-document',
});

export const metadata: Metadata = {
  title: 'SIEVEMK · Termly report generator',
  description: 'Generate SMK Gateway interim termly reports from tutor submissions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${ui.variable} ${document.variable}`}>
      <body>{children}</body>
    </html>
  );
}
