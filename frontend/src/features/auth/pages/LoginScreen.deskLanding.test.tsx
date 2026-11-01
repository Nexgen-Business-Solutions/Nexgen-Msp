import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSession } from '@/shared/hooks/useSession';
import { getSessionContext, type SessionContext } from '@/lib/api/session';
import { preLogin, completeLogin } from '@/lib/api/auth2fa';
import LoginScreen from './LoginScreen';

vi.mock('@/shared/hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('@/lib/api/session', async (original) => ({
  ...await original<typeof import('@/lib/api/session')>(), getSessionContext: vi.fn(),
}));
vi.mock('@/lib/api/auth2fa', () => ({ preLogin: vi.fn(), completeLogin: vi.fn() }));
vi.mock('../components/TwoFactorSetup', () => ({ default: () => <div>Setup</div> }));

const deskSession: SessionContext = {
  user: 'desk@example.invalid', authenticated: true, two_factor_passed: true,
  roles: ['MSP System Admin', 'MSP Customer Manager'], customers: ['A'],
  access: { ok: false, code: 'CONFLICTING_ROLES', message: 'Both sides.' },
  login_destination: { success: true, path: '/app', source: 'desk_access', rule: null, error: null },
};
const kept = window.location;
const replace = vi.fn();
const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...kept, replace, assign } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: kept });
});
const show = () => render(<MemoryRouter initialEntries={['/msp/login?redirect-to=/msp/devices/other']}><LoginScreen /></MemoryRouter>);

describe('sign-in applies the server Desk landing', () => {
  it('replaces a restored session with /app once, dropping the MSP deep link', async () => {
    vi.mocked(useSession).mockReturnValue({ data: deskSession, isLoading: false } as ReturnType<typeof useSession>);
    show();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('uses a fresh session after completing sign-in and does not use the pre-login verdict', async () => {
    vi.mocked(useSession).mockReturnValue({ data: { ...deskSession, authenticated: false, two_factor_passed: false }, isLoading: false } as ReturnType<typeof useSession>);
    vi.mocked(preLogin).mockResolvedValue({ pending_token: 'pending', full_name: 'Desk', needs_setup: false, requires_2fa: true, expires_in: 300 });
    vi.mocked(completeLogin).mockResolvedValue({ ok: true, user: deskSession.user, full_name: 'Desk', roles: [], session_expiry_seconds: 300 });
    vi.mocked(getSessionContext).mockResolvedValue(deskSession);
    show();
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: deskSession.user } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Enter your code');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '123456' } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    expect(completeLogin).toHaveBeenCalledOnce();
    expect(getSessionContext).toHaveBeenCalledOnce();
  });
});
