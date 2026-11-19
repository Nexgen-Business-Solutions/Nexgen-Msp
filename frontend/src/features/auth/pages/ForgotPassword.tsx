import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircleIcon, ArrowLeft, MailCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { FrappeError } from '@/lib/api/client';
import { requestPasswordReset } from '@/lib/api/auth';

const inputClass = 'ui-input';

const errorMessageFor = (err: unknown) => {
  if (err instanceof FrappeError) {
    if (err.status === 429) return 'Too many reset requests. Try again in an hour.';
    if (err.status === 404) return 'Account not found.';
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
          <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 p-3 text-emerald-800">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">
              Reset instructions are on their way. Check your inbox, and your spam folder.
            </span>
          </div>

          <Link
            to="/msp/login"
            className="ui-btn-secondary w-full py-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      ) : (
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
            <label htmlFor="email" className="ui-label">
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
            className="ui-btn-primary w-full"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <span>Send reset link</span>
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
      )}
    </AuthShell>
  );
}
