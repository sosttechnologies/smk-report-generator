/**
 * Everything is private.
 *
 * The UI is a static page under /app and talks to /api/*, so BOTH have to sit behind
 * this. Anyone who reaches the URL without a session gets the sign-in page and nothing
 * else — no report, no student name, no upload endpoint, not even the app's own
 * JavaScript.
 *
 * Exempt, deliberately and minimally:
 *   /signin, /api/auth/*   the way in
 *   /api/health            the uptime check, which must answer before anyone signs in
 *   Next's own assets      _next/*, favicon
 *
 * Next 16's "proxy" file always runs on Node, which is what makes this possible: it
 * reaches Prisma through src/auth.ts to validate a database session. (As an Edge
 * "middleware" file it failed with "Native module not found: node:util/types", and
 * declaring a runtime here is rejected.) Database sessions are worth having: removing
 * someone's access takes effect on their next request, which a signed JWT could not
 * promise.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { authDisabled, skipAuth } from '@/lib/authMode';

const PUBLIC = [/^\/signin$/, /^\/api\/auth(\/|$)/, /^\/api\/health$/];

/**
 * Where this request actually arrived, taken from the proxy headers rather than from
 * AUTH_URL — behind Fly the app sees http://localhost:3000 internally, and redirecting
 * someone there would send them nowhere.
 *
 * Header values come from outside, so nothing here may throw: a malformed or multi-value
 * X-Forwarded-Host used to produce an invalid URL and a 500, which turned a redirect to
 * the sign-in page into a server error.
 */
function origin(req: NextRequest): string {
  // In production APP_URL is the canonical public address, so prefer it: that way a
  // spoofed X-Forwarded-Host cannot steer a redirect at someone else's domain.
  if (process.env.APP_URL) {
    try { return new URL(process.env.APP_URL).origin; } catch { /* fall through */ }
  }
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || req.headers.get('host')?.trim();
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(host) ? 'http' : 'https');
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

/** Local development and the test suites: no database, no mailbox, no sign-in. */
function localBypass(req: NextRequest): NextResponse | null {
  return skipAuth(req.headers) ? NextResponse.next() : null;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const bypass = localBypass(req);
  if (bypass) return bypass;
  if (req.auth) return NextResponse.next();

  // An API caller wants a status code, not a login page it cannot render.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const url = new URL('/signin', origin(req));
  if (pathname !== '/') url.searchParams.set('from', pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  // Match everything except Next's build output, so a route added later is private by
  // default rather than accidentally public.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
