import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { DepartmentRow, InvoiceSettings } from '@/lib/api/internal';
import Settings from './Settings';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getInvoiceSettings: vi.fn(),
    getInvoiceDimensions: vi.fn(),
    listDepartments: vi.fn(),
    saveDepartment: vi.fn(),
    disableDepartment: vi.fn(),
    deleteDepartment: vi.fn(),
    listCustomers: vi.fn(),
  };
});

const invoiceSettings: InvoiceSettings = {
  issuer_name: 'Nexgen',
  issuer_address: null,
  issuer_phone: null,
  issuer_website: null,
  bank_currency: null,
  beneficiary: null,
  beneficiary_bank: null,
  intermediary_bank: null,
  footer_note: null,
  dispute_window_days: 10,
  payment_terms_days: 30,
  default_cost_center: null,
  show_cost_center_on_invoice: 0,
};

const department = (overrides: Partial<DepartmentRow> = {}): DepartmentRow => ({
  name: 'Accounting',
  department_name: 'Accounting',
  enabled: 1,
  description: null,
  sort_order: 0,
  used: 0,
  ...overrides,
});

const renderSettings = async (rows: DepartmentRow[]) => {
  vi.mocked(internal.getInvoiceSettings).mockResolvedValue(invoiceSettings);
  vi.mocked(internal.getInvoiceDimensions).mockResolvedValue([]);
  vi.mocked(internal.listDepartments).mockResolvedValue(rows);
  vi.mocked(internal.listCustomers).mockResolvedValue([
    { name: 'ACME', customer_name: 'ACME Corporation' },
    { name: 'BETA', customer_name: 'Beta Industries' },
  ] as Awaited<ReturnType<typeof internal.listCustomers>>);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>
  );

  fireEvent.click(await screen.findByRole('button', { name: /departments/i }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Settings — Departments', () => {
  it('lists every department with its status and who it is offered to', async () => {
    await renderSettings([
      department({ name: 'Accounting', department_name: 'Accounting', enabled: 1 }),
      department({ name: 'Archive', department_name: 'Archive', enabled: 0 }),
      department({ name: 'Workshop', department_name: 'Workshop', customer: 'ACME' }),
    ]);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getAllByText('All customers')).toHaveLength(2);
    expect(screen.getByText('Only for ACME')).toBeInTheDocument();
  });

  it('adds a department through the modal, never as free text on the table itself', async () => {
    await renderSettings([]);
    vi.mocked(internal.saveDepartment).mockResolvedValue([
      department({ name: 'Facilities', department_name: 'Facilities' }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: /^add department$/i }));

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByPlaceholderText('Research & Development');
    fireEvent.change(nameInput, { target: { value: 'Facilities' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /^add department$/i }));

    await waitFor(() =>
      expect(internal.saveDepartment).toHaveBeenCalledWith({
        name: undefined,
        department: {
          department_name: 'Facilities',
          description: '',
          enabled: 1,
          sort_order: null,
          customer: '',
        },
      })
    );
  });

  it('can hand a new department to one customer', async () => {
    await renderSettings([]);
    vi.mocked(internal.saveDepartment).mockResolvedValue([]);

    fireEvent.click(await screen.findByRole('button', { name: /^add department$/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Research & Development'), {
      target: { value: 'Workshop' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /all customers/i }));
    fireEvent.click(await screen.findByRole('option', { name: /acme corporation/i }));

    expect(within(dialog).getByText(/only this customer will see it/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^add department$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.saveDepartment).mock.calls[0][0].department).toMatchObject({
        department_name: 'Workshop',
        customer: 'ACME',
      })
    );
  });

  it('reads back the customer of one it edits, and can give it back to everyone', async () => {
    await renderSettings([department({ name: 'Workshop', department_name: 'Workshop', customer: 'ACME' })]);
    vi.mocked(internal.saveDepartment).mockResolvedValue([]);

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /edit department/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /acme corporation/i }));
    fireEvent.click(await screen.findByRole('option', { name: /all customers/i }));

    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.saveDepartment).mock.calls[0][0]).toMatchObject({
        name: 'Workshop',
        department: { customer: '' },
      })
    );
  });

  it('disables a department without deleting it', async () => {
    await renderSettings([department({ name: 'Accounting', department_name: 'Accounting', enabled: 1 })]);
    vi.mocked(internal.disableDepartment).mockResolvedValue([
      department({ name: 'Accounting', department_name: 'Accounting', enabled: 0 }),
    ]);

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /disable department/i }));

    await waitFor(() => expect(internal.disableDepartment).toHaveBeenCalledWith('Accounting'));
  });

  it('surfaces the in-use refusal message verbatim when a delete is blocked', async () => {
    await renderSettings([department({ name: 'Accounting', department_name: 'Accounting' })]);
    vi.mocked(internal.deleteDepartment).mockRejectedValue(
      new Error('This department is currently in use.\nDisable it instead of deleting it.')
    );

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete department/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(
      await within(dialog).findByText('This department is currently in use.', { exact: false })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Disable it instead of deleting it.', { exact: false })
    ).toBeInTheDocument();
  });

  it('deletes a department nothing points at', async () => {
    await renderSettings([department({ name: 'Unused', department_name: 'Unused' })]);
    vi.mocked(internal.deleteDepartment).mockResolvedValue([]);

    fireEvent.click(await screen.findByTitle('More options'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete department/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(internal.deleteDepartment).toHaveBeenCalledWith('Unused'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
