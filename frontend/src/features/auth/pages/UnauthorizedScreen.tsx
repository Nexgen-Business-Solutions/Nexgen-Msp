import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboardIcon, LogOutIcon, RotateCcwIcon, ShieldAlertIcon } from 'lucide-react';
import { logout } from '@/lib/api/client';
import { AppLogo } from '@/shared/components/appLogo';
import { useSession } from '@/shared/hooks/useSession';
import { sessionKeys } from '@/shared/hooks/useSession';
import { forgetRefusal, rememberedRefusal, type Refusal } from '@/router/unauthorized';

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
  const { data: session } = useSession();
  const [leaving, setLeaving] = useState(false);

  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();
  // the live verdict first: an administrator may have put this right since the redirect
  const said = session?.access?.ok === false ? session.access : null;
  const code = said?.code || carried.code || held.code || '';
  const message = said?.message || carried.message || held.message || FALLBACK;

  /** Ask the server again rather than replaying the answer that refused. */
  const tryAgain = () => {
    forgetRefusal();
    queryClient.invalidateQueries({ queryKey: sessionKeys.context });
    navigate('/msp', { replace: true });
  };

  const signOut = async () => {
    setLeaving(true);
    try {
      await logout();
    } finally {
      forgetRefusal();
      queryClient.clear();
      navigate('/msp/login', { replace: true });
    }
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
            <button type="button" onClick={tryAgain} className={primary}>
              <RotateCcwIcon className="h-4 w-4" />
              Try again
            </button>

            {session?.can_open_desk && (
              <a href="/app" className={secondary}>
                <LayoutDashboardIcon className="h-4 w-4" />
                Open the Desk
              </a>
            )}

            <button type="button" onClick={signOut} disabled={leaving} className={secondary}>
              <LogOutIcon className="h-4 w-4" />
              {leaving ? 'Signing out…' : 'Sign out'}
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
