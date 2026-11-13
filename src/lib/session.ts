/**
 * The caller, resolved once per request.
 *
 * Every storage route needs the same two things: who is asking, and which
 * organisation's data they may touch. The organisation comes from the session and never
 * from the request body — otherwise anyone signed in could read another organisation's
 * reports by guessing an id.
 */

import { auth, organisationFor } from '@/auth';

export interface Caller {
  userId: string;
  email: string;
  role: string;
  organisationId: string;
}

export async function caller(): Promise<Caller | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  // A user created before organisations existed, or whose organisation was removed,
  // gets one on demand rather than a 500.
  const organisationId = user.organisationId ?? (await organisationFor(user.id));
  return {
    userId: user.id,
    email: user.email ?? '',
    role: user.role ?? 'staff',
    organisationId,
  };
}
