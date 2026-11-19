import React from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { APP_NAME } from '@/shared/data/constant';

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const WELCOME_TEXT = `Welcome to ${APP_NAME}!`;
const LEFT_PANEL_TEXT =
  'Manage your users, devices, services and requests in one place, with secure access for your whole team.';

/** Same backdrop the TrixaPOS login uses, kept faint behind the page. */
const BACKGROUND_IMAGE =
  "bg-[url('https://img1.wsimg.com/isteam/getty/1304752349/:/cr=t:0%25,l:5.63%25,w:88.75%25,h:88.75%25/rs=w:1920,m')]";

const Copyright = ({ className = '' }: { className?: string }) => (
  <footer className={`text-sm ${className}`}>
    &copy; {new Date().getFullYear()} Nexgen Business Solutions. All rights reserved.
  </footer>
);

/**
 * The sign-in family of screens: a welcome panel on the left, the form in a card on the
 * right over a blue corner. Below the desktop breakpoint the panel folds into a header.
 */
export const AuthFrame: React.FC<{ children: React.ReactNode; footer?: React.ReactNode }> = ({ children, footer }) => (
  <div className="relative flex h-full min-h-screen w-full flex-col overflow-x-hidden overflow-y-auto bg-white md:bg-transparent xl:flex-row">
    <div aria-hidden className={`fixed inset-0 -z-10 ${BACKGROUND_IMAGE} bg-cover bg-center opacity-10`} />
    <div
      aria-hidden
      className="pointer-events-none fixed right-0 bottom-0 hidden h-screen w-[40%] bg-blue-600 [clip-path:polygon(100%_0,100%_100%,0%_100%)] xl:block"
    />

    {/* Left panel, desktop only */}
    <div className="hidden flex-col justify-between xl:flex xl:w-[60%]">
      <div className="flex items-center px-8 py-6">
        <img src="/assets/nexgen_msp/images/Nexgen-Logo.png" alt="Nexgen" className="h-10 w-auto" />
      </div>
      <div className="flex-1 space-y-6 p-10">
        <h2 className="text-5xl leading-tight font-bold text-balance text-slate-900">{WELCOME_TEXT}</h2>
        <p className="text-xl leading-relaxed text-slate-800">{LEFT_PANEL_TEXT}</p>
      </div>
      <Copyright className="p-6 text-slate-700" />
    </div>

    {/* Tablet header */}
    <div className="hidden shrink-0 flex-col items-center space-y-2 px-6 py-8 text-center md:flex xl:hidden">
      <img src="/assets/nexgen_msp/images/Nexgen-Logo.png" alt="Nexgen" className="h-12 w-auto" />
      <h2 className="text-3xl leading-tight font-bold text-balance text-slate-900">{WELCOME_TEXT}</h2>
      <p className="mt-1 max-w-lg text-base text-slate-600">{LEFT_PANEL_TEXT}</p>
    </div>

    {/* Form */}
    <div className="relative flex-1 md:flex md:items-center md:justify-center md:p-6 xl:p-10">
      <div className="relative w-full bg-white shadow-2xl md:mx-2 md:max-w-xl md:rounded-2xl md:border md:border-white/20 md:shadow-black/50">
        <div className="space-y-8 p-6 sm:p-8 md:p-12">
          <div className="mt-6 flex items-center justify-center">
            <img src="/assets/nexgen_msp/images/nexgen-icon.png" alt="Nexgen" width={100} height={100} />
          </div>

          <div>{children}</div>

          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-slate-100/80 pt-6 text-center text-sm text-slate-500">
            {footer ?? (
              <>
                <p>Powered by Nexgen</p>
                <div className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-slate-400">Secure login</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    <Copyright className="px-6 pb-6 text-center text-slate-500 xl:hidden" />
  </div>
);

/** Centred title block inside the card. */
export const AuthHeading: React.FC<{ eyebrow?: string; title: string; description?: string }> = ({
  eyebrow,
  title,
  description,
}) => (
  <div className="text-center">
    {eyebrow && <p className="text-xs font-bold tracking-widest text-blue-700">{eyebrow}</p>}
    <h1 className="mt-1 text-2xl leading-tight font-bold text-balance text-black md:text-3xl">{title}</h1>
    {description && <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p>}
  </div>
);

const AuthShell: React.FC<Props> = ({ eyebrow, title, description, children, footer }) => (
  <AuthFrame footer={footer}>
    <AuthHeading eyebrow={eyebrow} title={title} description={description} />
    {children}
  </AuthFrame>
);

export default AuthShell;
