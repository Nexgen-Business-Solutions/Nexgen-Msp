import React from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { AppLogo } from '@/shared/components/appLogo';

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

/** The sign-in family of screens, DeployOps style: a plain page, the logo, a large title, the form. */
export const AuthFrame: React.FC<{ children: React.ReactNode; footer?: React.ReactNode }> = ({ children, footer }) => (
  <div className="h-full w-full overflow-y-auto bg-white">
    <main className="flex min-h-full flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <AppLogo />
        <div className="mt-10">{children}</div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-400">
          {footer ?? (
            <>
              <span>Powered by Nexgen</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                Secure sign-in
              </span>
            </>
          )}
        </div>
      </div>
      <p className="mt-12 text-xs text-zinc-400">
        &copy; {new Date().getFullYear()} Nexgen Business Solutions. All rights reserved.
      </p>
    </main>
  </div>
);

/** Title block shared by the sign-in screens. The eyebrow stays for screen context, kept quiet. */
export const AuthHeading: React.FC<{ eyebrow?: string; title: string; description: string }> = ({ eyebrow, title, description }) => (
  <>
    {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{eyebrow}</p>}
    <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
    <p className="mt-2 text-[15px] leading-relaxed text-muted-ink">{description}</p>
  </>
);

const AuthShell: React.FC<Props> = ({ eyebrow, title, description, children, footer }) => (
  <AuthFrame footer={footer}>
    <AuthHeading eyebrow={eyebrow} title={title} description={description} />
    {children}
  </AuthFrame>
);

export default AuthShell;
