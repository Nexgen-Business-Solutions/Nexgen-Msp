import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircleIcon,
  HomeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { logout } from '@/lib/api/client';
import { AppLogo } from '@/shared/components/appLogo';
import { useSession } from '@/shared/hooks/useSession';
import { REASONS, forgetRefusal, rememberedRefusal, type Refusal } from '@/router/unauthorized';
import { isInternal, landingFor } from '../landing';

const HEADER = 'Access denied';
const FALLBACK =
  'This account is not allowed into Nexgen MSP. Ask an administrator what access it should have.';

const primary =
  'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60';

const secondary =
  'inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60';

export default function UnauthorizedScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, refetch } = useSession();
  const [busy, setBusy] = useState<'' | 'retry' | 'signout'>('');
  const [trouble, setTrouble] = useState('');

  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();
  // the live verdict first: an administrator may have put this right since the redirect
  const refusedEntry = session?.access?.ok === false ? session.access : null;
  const refusedHome =
    session?.login_destination && !session.login_destination.success
      ? session.login_destination
      : null;
  const live = refusedEntry?.code || refusedHome?.error || '';
  const code = live || carried.code || held.code || '';
  const message =
    refusedEntry?.message || carried.message || held.message || REASONS[code] || FALLBACK;

  // only a home the server has already authorised, and never the page that just refused us.
  // Read off the destination itself rather than off the landing: with no destination at all
  // the landing is this application, and offering that to an account it has just turned away
  // is a round trip back to here
  const authorised = session?.login_destination?.success ? session.login_destination.path : '';
  const elsewhere = authorised && authorised !== location.pathname ? authorised : '';

  /** Ask the server again rather than replaying the answer that refused. */
  const tryAgain = async () => {
    setBusy('retry');
    setTrouble('');
    forgetRefusal();

    try {
      // decided on the answer, not before it: a navigation now would be made on the
      // verdict that sent us here, and land straight back
      const { data: fresh } = await refetch();
      const next = landingFor(fresh);

      // both questions again, not one: navigating on a destination while entry is still
      // refused would only be sent straight back here by the route guard
      if (fresh?.access?.ok === false || next.code) {
        setTrouble('Still refused. Nothing has changed yet.');
        return;
      }

      if (isInternal(next.path)) navigate(next.path, { replace: true });
      else window.location.replace(next.path);
    } catch {
      setTrouble('We could not reach the server. Try again in a moment.');
    } finally {
      setBusy('');
    }
  };

  const signOut = async () => {
    setBusy('signout');
    setTrouble('');

    try {
      await logout();
    } catch {
      // the session may well still be open, so saying "signed out" would be a lie
      setTrouble('Signing out failed, so you may still be signed in. Try again.');
      setBusy('');
      return;
    }

    forgetRefusal();
    queryClient.clear();
    navigate('/msp/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <main className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
        <div className="border-t-4 border-blue-600">
          <AppLogo />
          <div className="border-t border-slate-100" />

          <div className="px-7 pt-6 pb-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-bold tracking-widest text-red-700">
              <ShieldAlertIcon className="h-3.5 w-3.5" />
              RESTRICTED
            </div>

            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{HEADER}</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed break-words text-slate-600">
              {message}
            </p>
          </div>
        </div>

        <div className="grid border-t border-slate-100 sm:grid-cols-[1fr_15rem]">
          <section className="space-y-3 p-7 sm:border-r sm:border-slate-100">
            {trouble && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50 p-3 text-amber-800"
              >
                <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">{trouble}</span>
              </div>
            )}

            <button type="button" onClick={tryAgain} disabled={Boolean(busy)} className={primary}>
              <RotateCcwIcon className="h-4 w-4" />
              {busy === 'retry' ? 'Checking…' : 'Try again'}
            </button>

            {elsewhere && (
              <a href={elsewhere} className={secondary}>
                <HomeIcon className="h-4 w-4" />
                Go to my home
              </a>
            )}

            {session?.can_open_desk && (
              <a href="/app" className={secondary}>
                <LayoutDashboardIcon className="h-4 w-4" />
                Open the Desk
              </a>
            )}

            <button
              type="button"
              onClick={signOut}
              disabled={Boolean(busy)}
              className={secondary}
            >
              <LogOutIcon className="h-4 w-4" />
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </button>
          </section>

          <aside className="divide-y divide-slate-100 bg-slate-50/70">
            <div className="px-6 py-4">
              <div className="text-[10px] font-bold tracking-widest text-slate-500">ACCOUNT</div>
              <div className="mt-1 text-sm font-semibold break-words text-slate-900">
                {session?.user || 'Guest'}
              </div>
            </div>
            <div className="px-6 py-4">
              <div className="text-[10px] font-bold tracking-widest text-slate-500">REASON</div>
              <div className="mt-1 text-sm font-semibold break-words text-slate-900">
                {code || 'Unknown'}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
