import { useEffect } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { initializeTheme } from './theme';
import { FrappeError, setSessionLostHandler } from './lib/api/client';

/** Only a lost session sends anyone back to the login screen.
 *
 * A 403 means the opposite: the session is valid, this account simply may not have that.
 * Treating it as an auth failure bounced a portal user with no customer between the app
 * and the login form for ever.
 */
const isAuthError = (error: unknown) =>
  error instanceof FrappeError && error.status === 401;

/** The one way out of a session that no longer exists, wherever it was noticed. */
const signInAgain = () => {
  if (window.location.pathname.startsWith('/msp/login')) return;

  queryClient.clear();
  window.location.assign(
    `/msp/login?redirect-to=${encodeURIComponent(window.location.pathname)}`
  );
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isAuthError(error)) signInAgain();
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !isAuthError(error) && failureCount < 2,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

// a read notices it through the cache above; a write notices it in the requester, and both
// end in the same place rather than each screen inventing its own message
setSessionLostHandler(signInAgain);

export default function App() {
  useEffect(() => {
    initializeTheme();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
