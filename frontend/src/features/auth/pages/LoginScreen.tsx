import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  AlertCircleIcon,
  EyeIcon,
  EyeClosed,
  ShieldCheckIcon,
} from 'lucide-react';
import { FrappeError } from '@/lib/api/client';
import { completeLogin, preLogin } from '@/lib/api/auth2fa';
import { mayEnterApplication } from '@/lib/api/session';
import { AppLogo } from '@/shared/components/appLogo';
import { useSession } from '@/shared/hooks/useSession';
import { errorMessageFor } from '../signInRefusals';
import { safeMspRedirect } from '../authRedirect';
import TwoFactorChallenge from '../components/TwoFactorChallenge';
import TwoFactorSetup from '../components/TwoFactorSetup';


const EYEBROW = 'WELCOME BACK';
const FORM_HEADER = 'Sign in';
const FORM_DESCRIPTION =
  'Use your Nexgen account to access your users, devices, services and requests.';


export default function LoginScreen() {
  const location = useLocation();
  // someone already signed in lands here when they are turned away from the desk; showing
  // them a login form would be absurd, so they go straight to the application
  const session = useSession();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState('');
  // the password alone opens nothing: it buys a token the code turns into a session
  const [pending, setPending] = useState<{ token: string; fullName: string } | null>(null);
  const [step, setStep] = useState<'credentials' | 'code' | 'setup'>('credentials');
  /** the one code already sent for the sign-in in hand, so it is never sent twice */
  const sent = useRef('');
  const [notice, setNotice] = useState('');

  if (mayEnterApplication(session.data)) return <Navigate to="/msp" replace />;

  const params = new URLSearchParams(location.search);
  const from = safeMspRedirect(
    params.get('redirect-to') || (location.state as { from?: string } | null)?.from
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
    if (error) setError('');
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();

    if (!credentials.username.trim() || !credentials.password) {
      setError('Enter your username and password.');
      return;
    }

    setLoginLoading(true);
    setError('');
    setNotice('');

    try {
      const answer = await preLogin(credentials.username.trim(), credentials.password);
      setPending({ token: answer.pending_token, fullName: answer.full_name });
      setStep(answer.needs_setup ? 'setup' : 'code');
      setCredentials((current) => ({ ...current, password: '' }));
    } catch (err) {
      setError(errorMessageFor(err));
      setCredentials((current) => ({ ...current, password: '' }));
    } finally {
      setLoginLoading(false);
    }
  };

  const submitCode = async (code: string) => {
    if (!pending || code.length !== 6 || loginLoading) return;

    // a sign-in is spent by the first code it accepts. The field sends the code the moment the
    // sixth digit lands, and the button sends it too: without this, pressing both spends the
    // sign-in on the first and reports the second as expired — having just let you in.
    if (sent.current === `${pending.token}:${code}`) return;

    sent.current = `${pending.token}:${code}`;
    setLoginLoading(true);
    setError('');

    try {
      await completeLogin({
        pending_token: pending.token,
        otp: code,
        username: credentials.username.trim(),
      });
      window.location.assign(from);
    } catch (err) {
      setError(errorMessageFor(err));

      // the two refusals that leave no sign-in behind: the server says it dropped the token,
      // so a code screen would only be a form with nothing to send to
      if (
        err instanceof FrappeError &&
        (err.code === 'PENDING_LOGIN_INVALID' || err.code === 'RATE_LIMITED')
      ) {
        backToCredentials();
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const backToCredentials = () => {
    sent.current = '';
    setPending(null);
    setStep('credentials');
    setCredentials((current) => ({ ...current, password: '' }));
  };

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-linear-to-br from-blue-50 via-slate-50 to-slate-100">
      
      {/* held in a layer of its own: clipping the page itself is what stopped it scrolling */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-blue-300/25 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-[28rem] w-[28rem] rounded-full bg-slate-300/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[70vh] w-[45%] bg-blue-600/90 [clip-path:polygon(100%_0,100%_100%,0%_100%)]" />
        <div className="absolute -bottom-16 left-1/4 h-72 w-72 rounded-full bg-slate-300/20 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-2xl border border-white/60 bg-white shadow-2xl shadow-blue-950/10">
          <AppLogo />

          <div className="border-t border-slate-100" />

          <div className="px-7 pt-6 pb-7">
            {step === 'code' && pending && (
              <TwoFactorChallenge
                fullName={pending.fullName}
                busy={loginLoading}
                error={error}
                onSubmit={submitCode}
                onCancel={backToCredentials}
              />
            )}

            {step === 'setup' && pending && (
              <TwoFactorSetup
                pendingToken={pending.token}
                onDone={() => {
                  setStep('credentials');
                  setPending(null);
                  setNotice(
                    'Two-factor authentication is on. Sign in again and enter the code from your app.'
                  );
                }}
                onCancel={backToCredentials}
              />
            )}

            {step === 'credentials' && (
            <>
            <p className="text-xs font-bold tracking-widest text-blue-700">{EYEBROW}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{FORM_HEADER}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{FORM_DESCRIPTION}</p>

            <form className="mt-6 space-y-5" onSubmit={handleLogin}>
              {notice && (
                <div className="flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-emerald-800">
                  <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{notice}</span>
                </div>
              )}

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
                <label
                  htmlFor="username"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Email or username
                </label>
                <input
                  id="username"
                  type="text"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={credentials.username}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900
                    transition-all duration-200 placeholder:text-slate-400
                    focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={credentials.password}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50/60 px-3.5 py-2.5 pr-11 text-sm text-slate-900
                      transition-all duration-200 placeholder:text-slate-400
                      focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeClosed className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <Link
                  to="/msp/forgot-password"
                  className="text-xs font-semibold text-blue-700 transition-colors hover:text-blue-900"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3
                  font-semibold text-white shadow-lg shadow-blue-600/20 transition-all duration-200
                  hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loginLoading ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <span>Sign in</span>
                )}
              </button>
            </form>
            </>
            )}

            <div className="text-center text-sm text-slate-500 pt-6 border-t border-slate-100/80 flex flex-wrap gap-x-2 gap-y-1 items-center justify-center">
              <p>Powered by Nexgen</p>
              <div className="flex items-center gap-1.5">
                <ShieldCheckIcon className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-slate-400">Secure sign-in</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="pointer-events-none fixed bottom-0 left-0 p-6 text-sm text-left text-slate-600">
        &copy; {new Date().getFullYear()} Nexgen Business Solutions. All rights reserved.
      </footer>
    </div>
  );
}
