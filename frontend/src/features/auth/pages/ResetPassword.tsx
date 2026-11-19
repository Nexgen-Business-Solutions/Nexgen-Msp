import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircleIcon, ArrowLeft, EyeClosed, EyeIcon } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { FrappeError } from '@/lib/api/client';
import { testPasswordStrength, updatePassword, type PasswordStrength } from '@/lib/api/auth';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

const inputClass = 'ui-input pr-12';

const STRENGTH = [
  { label: 'Very weak', bar: 'w-1/5 bg-red-500', text: 'text-red-600' },
  { label: 'Weak', bar: 'w-2/5 bg-amber-500', text: 'text-amber-600' },
  { label: 'Fair', bar: 'w-3/5 bg-amber-500', text: 'text-amber-600' },
  { label: 'Good', bar: 'w-4/5 bg-slate-500', text: 'text-slate-600' },
  { label: 'Strong', bar: 'w-full bg-emerald-500', text: 'text-emerald-600' },
];

const errorMessageFor = (err: unknown) => {
  if (err instanceof FrappeError) {
    if (err.status === 410) return 'This link has expired or has already been used. Request a new one.';
    if (err.status === 429) return 'Too many attempts. Try again in a few minutes.';
    if (err.status >= 500) return 'The server is unavailable. Please try again later.';
    return err.message || 'The password could not be changed.';
  }

  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';

  return 'An unexpected error occurred.';
};

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const key = searchParams.get('key') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  const debounced = useDebouncedValue(password, 400);

  useEffect(() => {
    if (!debounced) {
      setStrength(null);
      return;
    }

    let cancelled = false;
    testPasswordStrength(debounced)
      .then((result) => {
        if (!cancelled) setStrength(result);
      })
      .catch(() => {
        if (!cancelled) setStrength(null);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await updatePassword(key, password);
      window.location.assign('/msp');
    } catch (err) {
      setError(errorMessageFor(err));
      setLoading(false);
    }
  };

  if (!key) {
    return (
      <AuthShell
        eyebrow="ACCOUNT RECOVERY"
        title="Invalid link"
        description="This password reset link is incomplete. Request a new one to continue."
      >
        <div className="mt-6">
          <Link
            to="/msp/forgot-password"
            className="ui-btn-primary w-full"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  const meter = strength ? STRENGTH[Math.min(strength.score, 4)] : null;
  const suggestions = strength?.feedback?.suggestions ?? [];
  const warning = strength?.feedback?.warning;

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Choose a password"
      description="Pick a new password for your Nexgen account. You will be signed in straight away."
    >
      <form className="mt-8 space-y-4" onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3 text-red-700 animate-shake"
          >
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="password" className="ui-label">
            New password
          </label>
          <div className="relative">
            <input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError('');
              }}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-zinc-400 transition-colors hover:text-ink"
            >
              {show ? <EyeClosed className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>

          {meter && (
            <div className="mt-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full transition-all ${meter.bar}`} />
              </div>
              <p className={`mt-1 text-xs font-medium ${meter.text}`}>{meter.label}</p>
              {warning && <p className="mt-0.5 text-xs text-slate-500">{warning}</p>}
              {suggestions.map((suggestion) => (
                <p key={suggestion} className="mt-0.5 text-xs text-slate-400">
                  {suggestion}
                </p>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirm" className="ui-label">
            Confirm password
          </label>
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              if (error) setError('');
            }}
            className={inputClass}
          />
          {confirm && password !== confirm && (
            <p className="mt-1 text-xs font-medium text-red-600">The two passwords do not match.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !password || password !== confirm}
          className="ui-btn-primary w-full"
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span>Set password and sign in</span>
          )}
        </button>

        <Link
          to="/msp/login"
          className="ui-link flex items-center justify-center gap-1.5 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
