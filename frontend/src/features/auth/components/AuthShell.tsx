import React from 'react';
import { ShieldCheckIcon } from 'lucide-react';

const APP_NAME = 'Nexgen MSP';
const APP_TAGLINE = 'Service and billing portal';

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const AuthShell: React.FC<Props> = ({ eyebrow, title, description, children, footer }) => (
  <div className="relative min-h-screen w-full overflow-hidden bg-linear-to-br from-blue-50 via-indigo-50 to-slate-100">
    <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-blue-300/25 blur-3xl" />
    <div className="pointer-events-none absolute top-1/3 -right-24 h-[28rem] w-[28rem] rounded-full bg-indigo-300/20 blur-3xl" />
    <div className="pointer-events-none absolute bottom-0 right-0 h-[70vh] w-[45%] bg-blue-600/90 [clip-path:polygon(100%_0,100%_100%,0%_100%)]" />
    <div className="pointer-events-none absolute -bottom-16 left-1/4 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl" />

    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-white/60 bg-white shadow-2xl shadow-blue-950/10">
        <div className="flex items-center gap-3 px-7 pt-7 pb-5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-gray-900">{APP_NAME}</p>
            <p className="truncate text-xs text-blue-700">{APP_TAGLINE}</p>
          </div>
        </div>

        <div className="border-t border-gray-100" />

        <div className="px-7 pt-6 pb-7">
          <p className="text-xs font-bold tracking-widest text-blue-700">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>

          {children}

          <div className="text-center text-sm text-gray-500 pt-6 border-t border-gray-100/80 flex flex-wrap gap-x-2 gap-y-1 items-center justify-center">
            {footer ?? (
              <>
                <p>Powered by Nexgen</p>
                <div className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-gray-400">Secure sign-in</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    <footer className="absolute bottom-0 left-0 text-sm text-left p-6">
      &copy; {new Date().getFullYear()} Nexgen Business Solutions. All rights reserved.
    </footer>
  </div>
);

export default AuthShell;
