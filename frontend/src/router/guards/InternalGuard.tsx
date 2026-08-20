import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';

export default function InternalGuard({ children }: { children: ReactNode }) {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (isPortalOnly(session?.roles)) return <Navigate to="/msp" replace />;

  return <>{children}</>;
}
