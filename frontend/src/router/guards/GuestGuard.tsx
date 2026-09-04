import type { ReactNode } from 'react';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';

/** The login screen waits for the session check: someone still signed in never sees it. */
export default function GuestGuard({ children }: { children: ReactNode }) {
  const { isLoading, isError } = useSession();

  // an answer of any kind ends the wait: a fault must never leave someone on the loader
  if (isLoading && !isError) return <LoadingScreen />;

  return <>{children}</>;
}
