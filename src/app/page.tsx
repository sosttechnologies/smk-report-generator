import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * "/" only exists so the root is not a 404. The middleware already refuses an
 * unauthenticated visitor, but this checks too rather than trusting a route matcher
 * to be the single thing standing between a stranger and a child's report.
 */
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? '/app' : '/signin');
}
