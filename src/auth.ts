/**
 * Sign-in for the hosted app.
 *
 * Email magic link, restricted to an allowlist. Two deliberate choices:
 *
 *  - **No passwords.** Nothing to leak, reset, or reuse from another breach. Staff click
 *    a link in their inbox. For a tool holding children's records that is the lower risk.
 *  - **Allowlist, not registration.** ALLOWED_EMAILS decides who can ever get in; an
 *    address not on it is refused before any account exists. SMK add people by asking,
 *    not by anyone finding the URL.
 *
 * "Sign in with Microsoft" (Entra ID) is the intended addition once SMK's tenant admin
 * can create an app registration. It slots in as another entry in `providers` — the
 * allowlist and session handling below do not change.
 */

import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { db } from '@/lib/db';

/** Addresses allowed to sign in. Lower-cased and trimmed so a stray space cannot lock someone out. */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  // An empty allowlist denies everyone. Failing closed is the only safe default here:
  // a missing env var must not turn the app into open registration.
  if (!list.length) return false;
  const addr = email.trim().toLowerCase();
  if (list.includes(addr)) return true;
  // A whole domain may be allowed as "@sievemkgateway.org.uk".
  return list.some((entry) => entry.startsWith('@') && addr.endsWith(entry));
}

/** Every signed-in user belongs to one organisation; the first one is created on demand. */
export async function organisationFor(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { organisationId: true } });
  if (user?.organisationId) return user.organisationId;

  const existing = await db.organisation.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  const org = existing ?? (await db.organisation.create({ data: { name: 'SMK Gateway' }, select: { id: true } }));
  await db.user.update({ where: { id: userId }, data: { organisationId: org.id } });
  return org.id;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'database', maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: '/signin', verifyRequest: '/signin?sent=1', error: '/signin' },
  providers: [
    Resend({
      // Without a key the provider still runs; sendVerificationRequest below logs the
      // link instead of posting it, which is all local development needs.
      apiKey: process.env.RESEND_API_KEY ?? 'local-no-key',
      from: process.env.EMAIL_FROM ?? 'SMK Reports <onboarding@resend.dev>',
      async sendVerificationRequest({ identifier, url, provider }) {
        if (!process.env.RESEND_API_KEY) {
          console.log(`\n[sign-in] no RESEND_API_KEY set — link for ${identifier}:\n${url}\n`);
          return;
        }
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: 'Your sign-in link — SMK Gateway reports',
            text: `Sign in to the SMK Gateway report generator:\n\n${url}\n\nThis link works once and expires in 24 hours. If you did not ask for it, ignore this email.`,
          }),
        });
        if (!res.ok) throw new Error(`Could not send the sign-in email (${res.status})`);
      },
    }),
  ],
  callbacks: {
    signIn({ user }) {
      return isAllowed(user.email);
    },
    async session({ session, user }) {
      // The app needs to know who it is talking to and which organisation's data to show.
      session.user.id = user.id;
      const row = await db.user.findUnique({
        where: { id: user.id },
        select: { role: true, organisationId: true },
      });
      session.user.role = row?.role ?? 'staff';
      session.user.organisationId = row?.organisationId ?? null;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await organisationFor(user.id);
    },
  },
});
