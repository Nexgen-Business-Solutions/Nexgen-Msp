import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/shared/hooks/useSession';
import { isAdmin, isPortalOnly } from '@/shared/layout/navigation';

/**
 * The customer's own invoices.
 *
 * Nexgen staff have their own billing screen and are sent there rather than shown a page
 * that would ask them which customer they are acting for. A Customer Operator is sent home:
 * the invoices are the one thing their company decided they should not see, and an address
 * typed by hand must answer the same way the menu does.
 */
export default function InvoiceGuard({ children }: { children: ReactNode }) {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (!isPortalOnly(session?.roles)) {
    // an administrator has a billing screen of their own; anyone else on our side has none,
    // and bouncing them through it would only redirect them a second time
    return <Navigate to={isAdmin(session?.roles) ? '/msp/billing' : '/msp'} replace />;
  }

  if (session && session.can_see_invoices === false) {
    return <Navigate to="/msp" replace />;
  }

  return <>{children}</>;
}
