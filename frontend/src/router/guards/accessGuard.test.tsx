import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as client from '@/lib/api/client';
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

/** Refused the application, but with a home of its own elsewhere — a desk account on /msp. */
const refusedWithHome = (path: string) =>
  asSession({
    access: { ok: false, code: 'NO_MSP_ROLE', message: 'This account holds no Nexgen MSP role.' },
    login_destination: { success: true, rule: 'Frappe Desk', source: 'role', path, error: null },
  });

const sentTo = (path: string) =>
  asSession({
    roles: ['MSP Technician'],
    access: { ok: true, code: null, message: null },
    login_destination: { success: true, rule: 'Frappe Desk', source: 'role', path, error: null },
  });

const noHome = (error: string) =>
  asSession({
    roles: ['MSP Technician'],
    access: { ok: true, code: null, message: null },
    login_destination: { success: false, rule: null, source: null, path: null, error },
  });

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
  vi.mocked(client.logout).mockReset().mockResolvedValue({});
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

describe('a refused account is told where it does belong', () => {
  it('offers the home the server authorised, and not the page that refused it', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(refusedWithHome('/desk'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.getByRole('link', { name: /go to my home/i })).toHaveAttribute('href', '/desk');
  });

  it('sends somebody whose refusal has been lifted to their home instead of a wall', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    sessionStorage.setItem('msp_unauth_message', 'No role.');
    vi.mocked(session.getSessionContext).mockResolvedValue(sentTo('/msp'));

    screenAt('/msp/unauthorized');

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('msp_unauth_code')).toBeNull());
  });

  it('names what is missing rather than a role the account was never going to hold', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(
      asSession({
        access: { ok: false, code: 'NO_MSP_ROLE', message: 'No role.' },
        login_destination: {
          success: false,
          rule: null,
          source: null,
          path: null,
          error: 'NO_LOGIN_RULE',
        },
      })
    );

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.getByText('NO_LOGIN_RULE')).toBeInTheDocument();
    expect(screen.queryByText('NO_MSP_ROLE')).not.toBeInTheDocument();
  });

  it('keeps the entry reason when the destination only restates it', async () => {
    sessionStorage.setItem('msp_unauth_code', 'CONFLICTING_ROLES');
    vi.mocked(session.getSessionContext).mockResolvedValue(
      asSession({
        access: { ok: false, code: 'CONFLICTING_ROLES', message: 'Both sides at once.' },
        login_destination: {
          success: false,
          rule: null,
          source: null,
          path: null,
          error: 'MSP_ACCESS_DENIED',
        },
      })
    );

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.getByText('CONFLICTING_ROLES')).toBeInTheDocument();
    expect(screen.getByText('Both sides at once.')).toBeInTheDocument();
  });

  it('sends a non-MSP account to its own home once a rule gives it one', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_LOGIN_RULE');
    vi.mocked(session.getSessionContext)
      .mockResolvedValueOnce(noHome('NO_LOGIN_RULE'))
      .mockResolvedValue(refusedWithHome('/desk'));

    const replace = vi.fn();
    const kept = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...kept, replace },
    });

    try {
      screenAt('/msp/unauthorized');
      await screen.findByText('Access denied');

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      // the MSP verdict is still a refusal, and it is not the question being asked
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/desk'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: kept });
    }
  });

  it('stays put when the server could not be reached at all', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext)
      .mockResolvedValueOnce(refused('NO_MSP_ROLE', 'No role.'))
      .mockRejectedValue(new Error('offline'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('offers no home when the server authorised none', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_LOGIN_RULE');
    vi.mocked(session.getSessionContext).mockResolvedValue(noHome('NO_LOGIN_RULE'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.queryByRole('link', { name: /go to my home/i })).not.toBeInTheDocument();
  });

  it('offers no home while the site is not routing by rules at all', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(refused('NO_MSP_ROLE', 'No role.'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.queryByRole('link', { name: /go to my home/i })).not.toBeInTheDocument();
  });

  it('reads out a refusal that came from the login rules', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_LOGIN_RULE');
    vi.mocked(session.getSessionContext).mockResolvedValue(noHome('NO_LOGIN_RULE'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    expect(screen.getByText('NO_LOGIN_RULE')).toBeInTheDocument();
    expect(screen.getByText(/nothing says where this account belongs/i)).toBeInTheDocument();
  });
});

describe('the two ways off the denial screen', () => {
  it('waits for a fresh answer and stays put when it is still a refusal', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(refused('NO_MSP_ROLE', 'No role.'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/still refused/i)).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('leaves once the administrator has put it right', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext)
      .mockResolvedValueOnce(refused('NO_MSP_ROLE', 'No role.'))
      .mockResolvedValue(
        asSession({ roles: ['MSP Technician'], access: { ok: true, code: null, message: null } })
      );

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('does not claim a sign-out that the network refused', async () => {
    sessionStorage.setItem('msp_unauth_code', 'NO_MSP_ROLE');
    vi.mocked(session.getSessionContext).mockResolvedValue(refused('NO_MSP_ROLE', 'No role.'));
    vi.mocked(client.logout).mockRejectedValue(new Error('offline'));

    screenAt('/msp/unauthorized');
    await screen.findByText('Access denied');

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByText(/you may still be signed in/i)).toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
});
