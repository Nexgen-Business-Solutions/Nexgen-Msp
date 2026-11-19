import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  AlertCircleIcon,
  EyeIcon,
  EyeClosed,
  ShieldCheckIcon,
} from 'lucide-react';
import { FrappeError } from '@/lib/api/client';
import { completeLogin, preLogin } from '@/lib/api/auth2fa';
import { getSessionContext, mayEnterApplication } from '@/lib/api/session';
import { AuthFrame, AuthHeading } from '../components/AuthShell';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import { rememberRefusal } from '@/router/unauthorized';
import { errorMessageFor } from '../signInRefusals';
import { isInternal, landingFor } from '../landing';
import TwoFactorChallenge from '../components/TwoFactorChallenge';
import TwoFactorSetup from '../components/TwoFactorSetup';


const EYEBROW = 'WELCOME BACK';
const FORM_HEADER = 'Sign in';
const FORM_DESCRIPTION =
  'Use your Nexgen account to access your users, devices, services and requests.';


export default function LoginScreen() {
  const location = useLocation();
  // someone already signed in lands here when they are turned away from the desk; showing
  // them a login form would be absurd, so they go wherever they belong — which is decided
  // the same way as after a fresh sign-in, and is not always this application
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
  /** the one document navigation away from here, so a re-render cannot fire a second */
  const sentAway = useRef(false);
  const [notice, setNotice] = useState('');

  const requested =
    new URLSearchParams(location.search).get('redirect-to') ||
    (location.state as { from?: string } | null)?.from;

  const landing = mayEnterApplication(session.data) ? landingFor(session.data, requested) : null;
  const leaving = Boolean(landing && !isInternal(landing.path));
  const elsewhere = leaving ? landing?.path : undefined;

  // a destination outside this application is a document navigation, not a route change.
  // The guard is a ref rather than the dependency list: `landing` is a fresh object on
  // every render, and under Strict Mode the effect runs twice in any case
  useEffect(() => {
    if (!elsewhere || sentAway.current) return;

    sentAway.current = true;
    window.location.replace(elsewhere);
  }, [elsewhere]);

  if (landing) {
    if (leaving) return <LoadingScreen message="Taking you to your home…" />;

    return <Navigate to={landing.path} replace state={{ code: landing.code }} />;
  }

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

      setLoginLoading(false);
      return;
    }

    // past this point the session exists and the code is spent, so nothing here may be
    // reported as the code having failed: that would leave a signed-in account staring at
    // a form whose token is gone and whose code cannot be sent twice
    try {
      // asked for directly rather than read from the query cache: a context fetched before
      // this login would decide where to go using the previous account's verdict
      const next = landingFor(await getSessionContext(), requested);

      // the reason has to survive a document navigation, which drops router state
      if (next.code) rememberRefusal({ code: next.code });

      window.location.assign(next.path);
    } catch {
      // signed in, but we could not ask where to go. The application decides again on load
      window.location.assign('/msp');
    }
  };

  const backToCredentials = () => {
    sent.current = '';
    setPending(null);
    setStep('credentials');
    setCredentials((current) => ({ ...current, password: '' }));
  };

  return (
    <AuthFrame>
          <div>
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
            <AuthHeading eyebrow={EYEBROW} title={FORM_HEADER} description={FORM_DESCRIPTION} />

            <form className="mt-8 space-y-4" onSubmit={handleLogin}>
              {notice && (
                <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 p-3 text-emerald-800">
                  <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{notice}</span>
                </div>
              )}

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
                <label
                  htmlFor="username"
                  className="ui-label"
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
                  className="ui-input"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="ui-label"
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
                    className="ui-input pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-zinc-400 transition-colors hover:text-ink"
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
                  className="ui-link text-[13px]"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="ui-btn-primary w-full"
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

          </div>
    </AuthFrame>
  );
}
