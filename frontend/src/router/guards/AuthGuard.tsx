import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading, isError } = useSession();

  if (isLoading) return <LoadingScreen />;

  if (isError || !session?.authenticated) {
    return <Navigate to="/msp/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
