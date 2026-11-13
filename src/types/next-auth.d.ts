/** Extra fields the callbacks in src/auth.ts put on the session. */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
      organisationId: string | null;
    } & DefaultSession['user'];
  }
}
