import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircleIcon, ArrowLeft, MailCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { FrappeError } from '@/lib/api/client';
import { requestPasswordReset } from '@/lib/api/auth';

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-gray-50/60 px-3.5 py-2.5 text-sm text-gray-900 transition-all duration-200 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200';

const errorMessageFor = (err: unknown) => {
  if (err instanceof FrappeError) {
    if (err.status === 429) return 'Too many reset requests. Try again in an hour.';
    if (err.status >= 500) return 'The server is unavailable. Please try again later.';
    return err.message || 'The request could not be sent.';
  }

  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';

  return 'An unexpected error occurred.';
};

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!email.trim()) {
      setError('Enter the email address of your account.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessageFor(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Forgot password"
      description="Enter your email address and we will send you a link to choose a new password."
    >
      {sent ? (
        <div className="mt-6 space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-emerald-800">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">
              If this email is registered with us, reset instructions are on their way. Check your
              inbox, and your spam folder.
            </span>
          </div>

          <Link
            to="/msp/login"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      ) : (
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
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-gray-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError('');
              }}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all duration-200 hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <span>Send reset link</span>
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
      )}
    </AuthShell>
  );
}
