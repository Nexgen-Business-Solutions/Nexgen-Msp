import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as session from '@/lib/api/session';
import type { SessionContext } from '@/lib/api/session';
import AccessGuard from './AccessGuard';
import UnauthorizedGuard from './UnauthorizedGuard';
import UnauthorizedScreen from '@/features/auth/pages/UnauthorizedScreen';

/**
 * Who the application lets in, and what the one it refuses is shown.
 *
 * Signed in used to be taken for allowed in: an account with no role of ours, one whose
 * company permission was gone, and one holding both sides at once all reached the internal
 * screens and were then refused by every call those screens made. These hold the guard to
 * the server's verdict, and hold the denial screen to being a report on a decision rather
 * than a page anybody can walk onto.
 */

vi.mock('@/lib/api/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/session')>();
  return { ...actual, getSessionContext: vi.fn() };
});

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, logout: vi.fn().mockResolvedValue({}) };
});

const asSession = (over: Partial<SessionContext> = {}): SessionContext => ({
  user: 'somebody@example.invalid',
  authenticated: true,
  roles: [],
  customers: [],
  two_factor_passed: true,
  ...over,
});

const refused = (code: string, message: string) =>
  asSession({ access: { ok: false, code, message } });

const screenAt = (entry: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/msp"
            element={
              <AccessGuard>
                <div>Dashboard</div>
              </AccessGuard>
            }
          />
          <Route
            path="/msp/unauthorized"
            element={
              <UnauthorizedGuard>
                <UnauthorizedScreen />
              </UnauthorizedGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(session.getSessionContext).mockReset();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('who the application lets in', () => {
  it('lets a verdict that reads clean straight through', async () => {
    vi.mocked(session.getSessionContext).mockResolvedValue(
      asSession({ roles: ['MSP Technician'], access: { ok: true, code: null, message: null } })
    );

    screenAt('/msp');

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('passes a context carrying no verdict rather than locking everybody out', async () => {
    vi.mocked(session.getSessionContext).mockResolvedValue(asSession({ roles: ['MSP Technician'] }));

    screenAt('/msp');

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it.each([
    ['NO_MSP_ROLE', 'This account holds no Nexgen MSP role.'],
    ['NO_CUSTOMER_PERMISSION', 'This account reaches no company.'],
    ['CONFLICTING_ROLES', "This account holds both a Nexgen role and a customer's access."],
  ])('sends %s to the denial screen instead of the internal screens', async (code, message) => {
    vi.mocked(session.getSessionContext).mockResolvedValue(refused(code, message));

    screenAt('/msp');

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });
});

describe('what the refused account is offered', () => {
  it('offers the desk only where the account has one', async () => {
    vi.mocked(session.getSessionContext).mockResolvedValue(refused('NO_MSP_ROLE', 'No role.'));

    screenAt('/msp');
    await screen.findByText('Access denied');

    expect(screen.queryByRole('link', { name: /open the desk/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('offers the desk to an account that may open it', async () => {
    vi.mocked(session.getSessionContext).mockResolvedValue({
      ...refused('NO_MSP_ROLE', 'No role.'),
      can_open_desk: true,
    });

    screenAt('/msp');
    await screen.findByText('Access denied');

    expect(screen.getByRole('link', { name: /open the desk/i })).toHaveAttribute('href', '/app');
  });
});

describe('the denial screen is a report on a decision', () => {
  it('sends a visitor who simply typed its address back where they were going', async () => {
    vi.mocked(session.getSessionContext).mockResolvedValue(
      asSession({ roles: ['MSP Technician'], access: { ok: true, code: null, message: null } })
    );

    screenAt('/msp/unauthorized');

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('still reports the refusal after a reload has lost the router state', async () => {
    sessionStorage.setItem('msp_unauth_code', 'CONFLICTING_ROLES');
    sessionStorage.setItem('msp_unauth_message', 'Both sides at once.');
    vi.mocked(session.getSessionContext).mockResolvedValue(
      refused('CONFLICTING_ROLES', 'Both sides at once.')
    );

    screenAt('/msp/unauthorized');

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('CONFLICTING_ROLES')).toBeInTheDocument();
  });

  it('forgets the reason once the verdict reads clean', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(
      asSession({ roles: ['MSP Technician'], access: { ok: true, code: null, message: null } })
    );

    screenAt('/msp');
    await screen.findByText('Dashboard');

    await waitFor(() => expect(sessionStorage.getItem('msp_unauth_code')).toBeNull());
  });
});
