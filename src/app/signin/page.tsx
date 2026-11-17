/**
 * The only page a stranger can reach.
 *
 * Deliberately says little: the charity's name, a field, a button. No hint about who
 * holds an account, and the same confirmation whether or not the address is on the
 * allowlist — so this page cannot be used to find out who works at SMK.
 *
 * Styling is inline and self-contained rather than from the app's stylesheet, because
 * this renders before any of the app loads and must never depend on it.
 */

import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';

export const metadata = { title: 'Sign in — SMK Gateway reports' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; from?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user) redirect(params.from && params.from.startsWith('/') ? params.from : '/app');

  const sent = params.sent === '1';

  async function send(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    // Always report success. Telling a visitor "that address is not allowed" would
    // confirm which addresses exist.
    try {
      await signIn('resend', { email, redirect: false });
    } catch {
      /* swallowed on purpose — see above */
    }
    redirect('/signin?sent=1');
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <p style={S.eyebrow}>SMK Gateway</p>
        <h1 style={S.h1}>Termly reports</h1>

        {sent ? (
          <>
            <p style={S.body}>
              If that address has an account, a sign-in link is on its way. It works once and
              expires in 24 hours.
            </p>
            <p style={S.small}>
              Nothing arrived? Check junk mail, then ask whoever set this up to confirm your
              address is on the list.
            </p>
          </>
        ) : (
          <>
            <p style={S.body}>
              Staff access only. Enter your work email and we will send you a sign-in link —
              there is no password to remember.
            </p>
            {params.error ? (
              <p style={S.error}>That link did not work. Links expire after 24 hours, and each
                one can only be used once — please request another.</p>
            ) : null}
            <form action={send} style={S.form}>
              <label htmlFor="email" style={S.label}>Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="you@sievemkgateway.org.uk"
                style={S.input}
              />
              <button type="submit" style={S.button}>Email me a link</button>
            </form>
          </>
        )}

        <p style={S.footer}>
          Your sign-in link is personal to you. Please do not share it.
        </p>
      </div>
    </main>
  );
}

/* The app's palette, from .claude/skills/smk-app-design — espresso, sand, cream. */
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    margin: 0,
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    background: '#F7F6F3',
    color: '#1B1A17',
    fontFamily: "'Instrument Sans', system-ui, -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#FFFFFF',
    border: '1px solid #E6E3DC',
    borderRadius: 14,
    padding: '32px 28px',
    boxShadow: '0 1px 3px rgba(27,26,23,.08), 0 12px 32px rgba(27,26,23,.07)',
  },
  eyebrow: {
    margin: 0,
    fontSize: 10.5,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: '#9A968E',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  h1: { margin: '6px 0 14px', fontSize: 26, letterSpacing: '-.02em', fontWeight: 600 },
  body: { margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, color: '#4A4843' },
  small: { margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.5, color: '#6B6862' },
  error: {
    margin: '0 0 16px',
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.5,
    color: '#7A2A18',
    background: '#FBEEEA',
    border: '1px solid #F0D7CF',
    borderRadius: 8,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 12.5, color: '#4A4843', fontWeight: 500 },
  input: {
    height: 40,
    padding: '0 12px',
    fontSize: 14,
    borderRadius: 8,
    border: '1px solid #E6E3DC',
    background: '#FBFAF8',
    color: '#1B1A17',
  },
  button: {
    marginTop: 6,
    height: 40,
    border: 0,
    borderRadius: 8,
    background: '#2A211B',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  footer: {
    margin: '22px 0 0',
    paddingTop: 16,
    borderTop: '1px solid #EFECE6',
    fontSize: 11.5,
    lineHeight: 1.5,
    color: '#9A968E',
  },
};
