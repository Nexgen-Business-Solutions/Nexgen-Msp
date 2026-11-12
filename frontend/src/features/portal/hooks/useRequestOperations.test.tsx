import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import { usePortalFilters } from '../store/usePortalFilters';
import { useRequestOperations } from './usePortal';

/**
 * What may be asked of a scope is read for one company at a time.
 *
 * The answer in hand is kept while the next one is read, so moving between two scopes of
 * the same request does not blink. A company is not a scope: staff switching customer were
 * left looking at the acts of the one before, for people this request can no longer be
 * about.
 */
vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();

  return { ...actual, evaluateRequestOperations: vi.fn() };
});

const subjects = [{ subject_key: 'user:CU-001' }] as never[];

const answer = (customer: string) =>
  ({ customer, selected_subject_count: 1, domains: [] }) as never;

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  // one client for the whole render tree: a fresh one per render would lose the answer
  // this is about keeping
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const wrapper = Wrapper;

afterEach(() => {
  usePortalFilters.setState({ customer: null });
  vi.clearAllMocks();
});

describe('useRequestOperations', () => {
  it('shows nothing of the previous company while the next answer is still being read', async () => {
    usePortalFilters.setState({ customer: 'ACI' });
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValueOnce(answer('ACI'));

    const { result } = renderHook(() => useRequestOperations(subjects, ['user:CU-001']), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.customer).toBe('ACI'));

    // the next company's answer never arrives
    vi.mocked(portal.evaluateRequestOperations).mockImplementation(
      () => new Promise(() => undefined)
    );

    act(() => usePortalFilters.setState({ customer: 'SICG' }));

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('keeps the answer in hand while another scope of the same company is read', async () => {
    usePortalFilters.setState({ customer: 'ACI' });
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValueOnce(answer('ACI'));

    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useRequestOperations(subjects, keys),
      { wrapper, initialProps: { keys: ['user:CU-001'] } }
    );

    await waitFor(() => expect(result.current.data?.customer).toBe('ACI'));

    vi.mocked(portal.evaluateRequestOperations).mockImplementation(
      () => new Promise(() => undefined)
    );

    rerender({ keys: ['user:CU-002'] });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data?.customer).toBe('ACI');
  });
});
