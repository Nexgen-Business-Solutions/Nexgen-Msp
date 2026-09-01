import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { startTwoFactorSetup, verifyTwoFactorSetup } from '@/lib/api/auth2fa';
import OtpField from './OtpField';

type Props = {
  pendingToken?: string;
  onDone: () => void;
  onCancel: () => void;
};

/** Enrolment: scan, then prove it. Nothing is kept until the first code lands. */
const TwoFactorSetup: React.FC<Props> = ({ pendingToken, onDone, onCancel }) => {
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  // scanning and typing are two moments, not one crowded screen
  const [step, setStep] = useState<'scan' | 'verify'>('scan');

  useEffect(() => {
    let alive = true;

    startTwoFactorSetup(pendingToken)
      .then(async (challenge) => {
        if (!alive) return;
        setSecret(challenge.secret);
        setIssuer(challenge.issuer);
        setAccount(challenge.account);
        setQr(
          await QRCode.toDataURL(challenge.otpauth_uri, {
            width: 240,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          })
        );
      })
      .catch((err) => alive && setError(err?.message || 'Could not start the setup.'));

    return () => {
      alive = false;
    };
  }, [pendingToken]);

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return;

    setBusy(true);
    setError('');

    try {
      await verifyTwoFactorSetup(value, pendingToken);
      onDone();
    } catch (err) {
      setError((err as Error)?.message || 'That code was not accepted.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const steps: { key: 'scan' | 'verify'; label: string }[] = [
    { key: 'scan', label: 'Scan' },
    { key: 'verify', label: 'Confirm' },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        {steps.map((entry, index) => {
          const at = steps.findIndex((item) => item.key === step);
          const done = index < at;
          const here = index === at;

          return (
            <React.Fragment key={entry.key}>
              <span
                className={`flex items-center gap-1.5 text-xs font-semibold ${
                  here ? 'text-blue-700' : done ? 'text-emerald-600' : 'text-gray-400'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    here
                      ? 'border-blue-600 text-blue-700'
                      : done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-gray-300 text-gray-400'
                  }`}
                >
                  {done ? <CheckIcon className="h-3 w-3" /> : index + 1}
                </span>
                {entry.label}
              </span>
              {index === 0 && <span className="h-px flex-1 bg-gray-200" />}
            </React.Fragment>
          );
        })}
      </div>

      <p className="text-xs font-bold tracking-widest text-blue-700">ONE LAST STEP</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
        {step === 'scan' ? 'Set up your authenticator' : 'Confirm the code'}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">
        {step === 'scan'
          ? 'Scan this with Google Authenticator, Microsoft Authenticator or any app of the kind.'
          : 'Your app now shows a six-digit code that changes every thirty seconds. Type the one on screen.'}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3 text-red-700"
        >
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {step === 'scan' && (
      <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        {qr ? (
          <img src={qr} alt="Scan this code with your authenticator app" className="h-44 w-44" />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          </div>
        )}

        {account && (
          <p className="text-center text-xs text-gray-500">
            {issuer} · {account}
          </p>
        )}

        {secret && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(secret);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs tracking-wider text-gray-700 transition-colors hover:bg-gray-50"
            title="If you cannot scan, type this into the app"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {secret}
          </button>
        )}
      </div>
      )}

      {step === 'scan' ? (
        <button
          type="button"
          onClick={() => setStep('verify')}
          disabled={!secret}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Continue
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      ) : (
        <>
          <div className="mt-5">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">
              Code from the app
            </span>
            <OtpField
              value={code}
              onChange={setCode}
              onComplete={submit}
              disabled={busy || !secret}
              autoFocus
            />
          </div>

          <button
            type="button"
            onClick={() => submit(code)}
            disabled={code.length !== 6 || busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>
                <ShieldCheckIcon className="h-4 w-4" />
                Turn it on
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep('scan');
              setCode('');
              setError('');
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Back to the QR code
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full text-center text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700"
      >
        Back to sign in
      </button>
    </div>
  );
};

export default TwoFactorSetup;
