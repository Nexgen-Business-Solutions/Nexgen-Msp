import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import {
  UNAUTHORIZED_PATH,
  forgetRefusal,
  rememberRefusal,
} from '../unauthorized';

/**
 * Signed in is not the same as allowed in.
 *
 * Three accounts used to reach the application and then be refused by every call it made:
 * one holding no role of ours, one belonging to a company it has no permission for, and one
 * holding both sides at once. The first and the last read as neither a customer's person nor
 * one of ours, so the layout fell through to the staff side and showed an internal dashboard
 * nobody could load a row of.
 *
 * The verdict is the server's — `access.entry`, next to the rules it is made of — and this
 * guard only applies it. A context without one passes through: a client that has outrun its
 * server must not lock everybody out.
 */
export default function AccessGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading } = useSession();
  const verdict = session?.access;
  const refused = Boolean(verdict && !verdict.ok);

  // a verdict that now reads clean must not leave a reason behind for the denial screen
  useEffect(() => {
    if (verdict?.ok) forgetRefusal();
  }, [verdict?.ok]);

  if (isLoading) return <LoadingScreen message="Checking your access…" />;

  if (refused) {
    rememberRefusal({ code: verdict?.code, message: verdict?.message });

    return (
      <Navigate
        to={UNAUTHORIZED_PATH}
        replace
        state={{
          code: verdict?.code,
          message: verdict?.message,
          from: location.pathname,
        }}
      />
    );
  }

  const path = location.pathname.replace(/\/+$/, '');
  const scopedResource = path === '/msp/services' || (
    /^\/msp\/(users|devices|requests)(\/[^/]+)?$/.test(path) && path !== '/msp/requests/new'
  );
  if (session?.scoped_msp && (!scopedResource || !session.customers.length)) {
    return <main className="mx-auto max-w-3xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">Your MSP access</h1>
      <p>Your customer access remains limited to the companies below. Use Desk for your existing staff tools.</p>
      {session.customers.length ? <>
        <ul>{session.customers.map((customer) => <li key={customer}>{customer}</li>)}</ul>
        <nav className="flex flex-wrap gap-4">{['users', 'devices', 'services', 'requests'].map((page) =>
          <Link key={page} to={`/msp/${page}`}>{page[0].toUpperCase() + page.slice(1)}</Link>)}</nav>
      </> : <p>No customer data is available: a matching Contact and Customer User Permission are required.</p>}
      {session.can_open_desk && <a href="/app">Open Desk</a>}
    </main>;
  }
  return <>{children}</>;
}
