import { redirect } from 'next/navigation';

/** The product lives at /app. This route only exists so / is not a 404. */
export default function Home() {
  redirect('/app');
}
