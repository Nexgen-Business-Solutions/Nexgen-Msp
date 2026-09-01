import React, { useState } from 'react';
import { AlertCircle, CircleCheck, EyeClosed, EyeIcon, ShieldCheck, ShieldOff } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import { resetOwnTwoFactor } from '@/lib/api/auth2fa';
import { useSession } from '@/shared/hooks/useSession';

type Props = { open: boolean; onClose: () => void };

/**
 * A person's own second factor, and the one thing they can do to it alone: undo it.
 *
 * Undoing is all this screen does. Setting one up belongs to the sign-in flow, where the
 * app already refuses to open a session without one — so a reset here simply means the
 * next sign-in asks for a new authenticator.
 *
 * The account password is what has to be proven — not the current code. The commonest
 * reason to reset is a phone that is lost or replaced, and someone without the
 * authenticator could never produce a code. What this screen must guard against is a
 * session left open on an unattended machine, and a password does exactly that.
 */
const MyTwoFactorModal: React.FC<Props> = ({ open, onClose }) => {
  const session = useSession();
  const enabled = Boolean(session.data?.two_factor_enabled);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const reset = async () => {
    if (!password || busy) return;

    setBusy(true);
    setError('');

    try {
      await resetOwnTwoFactor(password);
      setPassword('');
      setDone(true);
      session.refetch();
    } catch (err) {
      setError((err as Error)?.message || 'That password was not accepted.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setPassword('');
    setError('');
    setDone(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      icon={ShieldCheck}
      tone="blue"
      title="Two-factor authentication"
      subtitle={session.data?.user}
      widthClass="max-w-md"
    >
      {done ? (
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CircleCheck size={16} />
            It has been undone
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your authenticator no longer works for this account. The next time you sign in, the
            app will walk you through setting up a new one before letting you in.
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-5 w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      ) : !enabled ? (
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <ShieldOff size={16} />
            Not set up on this account
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The next time you sign in, the app will ask you to set up an authenticator before
            letting you in. There is nothing to do from here.
          </p>
        </div>
      ) : (
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <ShieldCheck size={16} />
            It is on for this account
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Resetting undoes it: your current authenticator stops working, and you set up a new
            one the next time you sign in. Confirm with your password — it works whether you
            still have the old phone or not.
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3 text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          <div className="mt-5">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">
              Your password
            </span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') reset();
                }}
                disabled={busy}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                {showPassword ? <EyeClosed className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={reset}
            disabled={!password || busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>
                <ShieldOff size={15} />
                Reset it
              </>
            )}
          </button>
        </div>
      )}
    </Modal>
  );
};

export default MyTwoFactorModal;
