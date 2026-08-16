import { useEffect } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { initializeTheme } from './theme';
import { FrappeError } from './lib/api/client';

const isAuthError = (error: unknown) =>
  error instanceof FrappeError && (error.status === 401 || error.status === 403);

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (!isAuthError(error)) return;
      if (window.location.pathname.startsWith('/msp/login')) return;

      queryClient.clear();
      window.location.assign(
        `/msp/login?redirect-to=${encodeURIComponent(window.location.pathname)}`
      );
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
