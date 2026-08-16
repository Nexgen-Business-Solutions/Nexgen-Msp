import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/shared/hooks/useSession';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading, isError } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (isError || !session?.authenticated) {
    return <Navigate to="/msp/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
