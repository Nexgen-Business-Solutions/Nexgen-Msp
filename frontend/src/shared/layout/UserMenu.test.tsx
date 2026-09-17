import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserMenu from './UserMenu';
import { useSession } from '@/shared/hooks/useSession';

vi.mock('@/shared/hooks/useSession', () => ({ useSession: vi.fn() }));
vi.mock('@/features/auth/components/MyTwoFactorModal', () => ({ default: () => null }));

afterEach(cleanup);

const openMenu = (userType: string, roles: string[]) => {
  vi.mocked(useSession).mockReturnValue({
    data: { user: 'someone@example.invalid', full_name: 'Some One', user_type: userType, roles },
  } as never);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>
    </QueryClientProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: /some one/i }));
};

describe('the way to the desk', () => {
  it('is offered to an account Frappe lets onto the desk', () => {
    openMenu('System User', ['MSP System Admin']);

    const link = screen.getByRole('link', { name: /open desk/i });
    expect(link).toHaveAttribute('href', '/app');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('is not offered to a technician, who is kept off the desk', () => {
    openMenu('Website User', ['MSP Technician']);

    expect(screen.queryByRole('link', { name: /open desk/i })).not.toBeInTheDocument();
  });

  it('is not offered to a customer', () => {
    openMenu('Website User', ['MSP Customer Manager']);

    expect(screen.queryByRole('link', { name: /open desk/i })).not.toBeInTheDocument();
  });
});
