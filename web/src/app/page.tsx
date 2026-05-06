import { auth } from '@/server/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.email) redirect('/login');
  return <Dashboard userEmail={session.user.email} />;
}
