import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import * as presentationApi from '@/lib/api/requestPresentation';
import type { PortalRequestDetail as Detail } from '@/lib/api/portal';
import type { RequestPresentation } from '@/lib/api/requestPresentation';
import { presentationFixture } from '@/shared/request/presentation.fixture';
import PortalRequestDetail from './PortalRequestDetail';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return { ...actual, getRequest: vi.fn(), approveRequest: vi.fn(), rejectRequest: vi.fn() };
});

vi.mock('@/lib/api/requestPresentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/requestPresentation')>();
  return { ...actual, getPortalRequestPresentation: vi.fn() };
});

const detail = (overrides: Partial<Detail> = {}): Detail => ({
  name: 'SR-2026-00544',
  customer: 'ACI',
  request_type: 'Add',
  status: 'Awaiting Customer Approval',
  priority: 'Medium',
  details: null,
  requested_date: null,
  source: 'Portal',
  creation: '2026-09-27',
  modified: '2026-09-27',
  rejection_reason: null,
  refused_by_customer: false,
  reviewed_on: null,
  can_decide: true,
  can_edit: false,
  has_approver: true,
  lines: [],
  subjects: [],
  requested_devices: [],
  restorable: true,
  action_groups: [],
  ...overrides,
});

const awaiting = (): RequestPresentation => {
  const shown = presentationFixture();
  shown.request.status = 'Awaiting Customer Approval';
  shown.request.customer_approval = { state: 'pending', by_name: null, at: null, label: 'Awaiting approval' };
  shown.request.nexgen_status_label = 'Not sent to Nexgen yet';
  shown.request.badges = [
    { tone: 'amber', label: 'AWAITING CUSTOMER APPROVAL' },
    { tone: 'slate', label: 'MEDIUM' },
    { tone: 'amber', label: '2 NEW ENTITIES' },
  ];
  return shown;
};

const Builder = () => {
  const { search } = useLocation();

  return (
    <>
      <div>Request builder</div>
      <p data-testid="builder-query">{search}</p>
    </>
  );
};

const renderPage = async (data: Detail, shown: RequestPresentation = awaiting()) => {
  vi.mocked(portal.getRequest).mockResolvedValue(data);
  vi.mocked(presentationApi.getPortalRequestPresentation).mockResolvedValue(shown);

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/msp/requests/SR-2026-00544']}>
        <Routes>
          <Route path="/msp/requests/:name" element={<PortalRequestDetail />} />
          <Route path="/msp/requests/new" element={<Builder />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByRole('heading', { name: 'Request SR-2026-00544' });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a request waiting for the viewer to approve it', () => {
  it('is presented in customer approval mode with the sticky approval bar', async () => {
    await renderPage(detail());

    expect(
      screen.getByText('Review the exact request submitted by Devteam Cam before it is sent to Nexgen.')
    ).toBeInTheDocument();
    expect(screen.getByText('Internal approval required')).toBeInTheDocument();
    expect(
      screen.getByText('Approval records intent only. No MSP lifecycle operation is executed here.')
    ).toBeInTheDocument();
    expect(screen.getByText('Add Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Not sent to Nexgen yet')).toBeInTheDocument();
    expect(presentationApi.getPortalRequestPresentation).toHaveBeenCalledWith('SR-2026-00544', expect.anything());
  });

  it('approves through the existing mutation', async () => {
    vi.mocked(portal.approveRequest).mockResolvedValue({} as never);
    await renderPage(detail());

    fireEvent.click(screen.getByRole('button', { name: 'Approve and send to Nexgen' }));

    await waitFor(() => expect(portal.approveRequest).toHaveBeenCalledWith('SR-2026-00544', undefined));
    expect(portal.rejectRequest).not.toHaveBeenCalled();
  });

  it('rejects only with a reason, through the exact dialog', async () => {
    vi.mocked(portal.rejectRequest).mockResolvedValue({} as never);
    await renderPage(detail());

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('A reason is required and will be visible in the request history.')
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Reason *')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Reject request' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Reason *'), { target: { value: 'Not this quarter' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(portal.rejectRequest).toHaveBeenCalledWith('SR-2026-00544', 'Not this quarter'));
    expect(portal.approveRequest).not.toHaveBeenCalled();
  });

  it('shows the refusal the server sends back', async () => {
    vi.mocked(portal.approveRequest).mockRejectedValue(new Error('You cannot approve this request.'));
    await renderPage(detail());

    fireEvent.click(screen.getByRole('button', { name: 'Approve and send to Nexgen' }));

    expect(await screen.findByText('You cannot approve this request.')).toBeInTheDocument();
  });
});

describe('a request the viewer may not decide', () => {
  it('is a read-only portal detail that says who it is waiting for', async () => {
    await renderPage(detail({ can_decide: false, has_approver: true }));

    expect(screen.queryByText('Internal approval required')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and send to Nexgen' })).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for approval inside your company\. It reaches Nexgen/)).toBeInTheDocument();
  });

  it('says when nobody at the company can approve yet', async () => {
    await renderPage(detail({ can_decide: false, has_approver: false }));

    expect(screen.getByText(/nobody at your company holds the right to approve yet/)).toBeInTheDocument();
  });

  it('offers to correct and resend a declined request, with the answer received', async () => {
    const shown = presentationFixture();
    shown.request.status = 'Rejected';
    shown.request.rejection = { reason: 'Out of contract', by: 'nexgen', by_name: null, at: null };
    await renderPage(
      detail({ status: 'Rejected', can_decide: false, rejection_reason: 'Out of contract', refused_by_customer: false }),
      shown
    );

    expect(screen.getByText('Rejected by Nexgen')).toBeInTheDocument();
    expect(screen.getAllByText('Out of contract')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));

    expect(await screen.findByText('Request builder')).toBeInTheDocument();
  });

  it('carries no execution control and no assignee', async () => {
    const shown = presentationFixture();
    shown.request.status = 'In Progress';
    await renderPage(detail({ status: 'In Progress', can_decide: false }), shown);

    expect(screen.queryByRole('button', { name: /accept|reject|execute|approve/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Assigned|Assignee|Owner|Technician/);
    expect(screen.getByText('Requested entities')).toBeInTheDocument();
  });
});

describe('a request its requester may still modify', () => {
  const sent = () => {
    const shown = presentationFixture();
    shown.request.status = 'Submitted';
    return shown;
  };

  it('offers "Edit request", which opens the builder on that very request', async () => {
    await renderPage(detail({ status: 'Submitted', can_decide: false, can_edit: true }), sent());

    const header = screen.getByRole('heading', { name: 'Request SR-2026-00544' }).closest('section') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: 'Edit request' }));

    expect(await screen.findByText('Request builder')).toBeInTheDocument();
    expect(screen.getByTestId('builder-query').textContent).toBe('?edit=SR-2026-00544');
  });

  it('offers nothing to edit once the server says the request may not be modified', async () => {
    await renderPage(detail({ status: 'Submitted', can_decide: false, can_edit: false }), sent());

    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.queryByText('Request builder')).not.toBeInTheDocument();
  });

  it('keeps the approval bar next to "Edit request" when the requester may also approve', async () => {
    await renderPage(detail({ can_edit: true }));

    expect(screen.getByRole('button', { name: 'Edit request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send to Nexgen' })).toBeInTheDocument();
  });
});
