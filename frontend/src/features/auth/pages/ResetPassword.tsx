import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircleIcon, ArrowLeft, EyeClosed, EyeIcon } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { FrappeError } from '@/lib/api/client';
import { testPasswordStrength, updatePassword, type PasswordStrength } from '@/lib/api/auth';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-gray-50/60 px-3.5 py-2.5 pr-11 text-sm text-gray-900 transition-all duration-200 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200';

const STRENGTH = [
  { label: 'Very weak', bar: 'w-1/5 bg-red-500', text: 'text-red-600' },
  { label: 'Weak', bar: 'w-2/5 bg-orange-500', text: 'text-orange-600' },
  { label: 'Fair', bar: 'w-3/5 bg-amber-500', text: 'text-amber-600' },
  { label: 'Good', bar: 'w-4/5 bg-lime-500', text: 'text-lime-600' },
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
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30"
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
      <form className="mt-6 space-y-5" onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3 text-red-700 animate-shake"
          >
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-gray-700">
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
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              {show ? <EyeClosed className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>

          {meter && (
            <div className="mt-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div className={`h-full rounded-full transition-all ${meter.bar}`} />
              </div>
              <p className={`mt-1 text-xs font-medium ${meter.text}`}>{meter.label}</p>
              {warning && <p className="mt-0.5 text-xs text-gray-500">{warning}</p>}
              {suggestions.map((suggestion) => (
                <p key={suggestion} className="mt-0.5 text-xs text-gray-400">
                  {suggestion}
                </p>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-xs font-semibold text-gray-700">
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
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all duration-200 hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span>Set password and sign in</span>
          )}
        </button>

        <Link
          to="/msp/login"
          className="flex items-center justify-center gap-1.5 text-sm font-medium text-blue-700 transition-colors hover:text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
