import { APP_NAME } from '../data/constant';

/** What is shown while the session is still being checked — never the login form. */
export default function LoadingScreen({ message = 'Checking your session…' }: { message?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-slate-50">
      <img src="/assets/nexgen_msp/images/Nexgen-Logo.png" width="96" alt={APP_NAME} />
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
