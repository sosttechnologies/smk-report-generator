/**
 * Local single-user mode.
 *
 * `npm run dev` and the browser test suites drive the app with no database and no
 * mailbox, so requiring a sign-in there would mean neither could run. AUTH_DISABLED=true
 * turns the gate off — but ONLY for requests that genuinely arrived at localhost.
 *
 * That second condition is the point. A deployment is reached by hostname and carries a
 * real client address, so its requests never look local and the gate stays shut even if
 * AUTH_DISABLED is copied into production secrets by mistake. Fail closed: a
 * configuration slip must not publish children's reports.
 *
 * Note that Next.js sets x-forwarded-host and x-forwarded-for on every request, loopback
 * ones included, so their mere presence proves nothing — only their values do.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

/** Strips the port from a host, coping with [::1]:3000, ::1 and localhost:3000 alike. */
function bareHost(raw: string): string {
  const v = raw.trim().toLowerCase();
  const bracketed = v.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const withPort = v.match(/^([^:]+):\d+$/);
  if (withPort) return withPort[1];
  return v;
}

const isLoopback = (addr: string) => LOOPBACK.has(bareHost(addr).replace(/^::ffff:/, ''));

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === 'true';
}

/** True only for a request that really came from this machine. */
export function isLocalRequest(headers: Headers): boolean {
  const forwardedHost = headers.get('x-forwarded-host');
  // More than one value means a chain of proxies in front of us: not local.
  if (forwardedHost?.includes(',')) return false;
  if (!isLoopback(forwardedHost ?? headers.get('host') ?? '')) return false;

  // The client address, if anything recorded one, must also be loopback.
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor && !isLoopback(forwardedFor.split(',')[0] ?? '')) return false;

  return true;
}

/** Whether this particular request may skip signing in. */
export function skipAuth(headers: Headers): boolean {
  return authDisabled() && isLocalRequest(headers);
}
