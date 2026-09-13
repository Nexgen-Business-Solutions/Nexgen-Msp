import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import { mayEnterApplication } from '@/lib/api/session';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading, isError } = useSession();

  if (isLoading) return <LoadingScreen />;

  if (isError || !mayEnterApplication(session)) {
    return <Navigate to="/msp/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
