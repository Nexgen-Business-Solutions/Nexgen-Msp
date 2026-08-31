import React, { useState } from 'react';
import { AlertCircleIcon, ShieldCheckIcon } from 'lucide-react';
import OtpField from './OtpField';

type Props = {
  fullName: string;
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
  onCancel: () => void;
};

/** Second step of signing in: the password is behind us, the code is not. */
const TwoFactorChallenge: React.FC<Props> = ({ fullName, busy, error, onSubmit, onCancel }) => {
  const [code, setCode] = useState('');

  return (
    <div>
      <p className="text-xs font-bold tracking-widest text-blue-700">VERIFY IT IS YOU</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">Enter your code</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">
        {fullName ? `${fullName}, open` : 'Open'} your authenticator app and type the six digits it
        shows.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3 text-red-700 animate-shake"
        >
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      <div className="mt-6">
        <OtpField
          value={code}
          onChange={(value) => setCode(value)}
          onComplete={onSubmit}
          disabled={busy}
          autoFocus
        />
      </div>

      <button
        type="button"
        onClick={() => onSubmit(code)}
        disabled={code.length !== 6 || busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-br from-blue-600 to-blue-800 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <>
            <ShieldCheckIcon className="h-4 w-4" />
            Sign in
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full text-center text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700"
      >
        Use another account
      </button>
    </div>
  );
};

export default TwoFactorChallenge;
