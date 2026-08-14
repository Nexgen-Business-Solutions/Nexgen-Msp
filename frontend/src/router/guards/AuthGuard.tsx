import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getLoggedUser } from '@/lib/api/client';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getLoggedUser()
      .then((user) => {
        if (!cancelled) setCurrentUser(user);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50">
        <span className="h-8 w-8 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/msp/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
