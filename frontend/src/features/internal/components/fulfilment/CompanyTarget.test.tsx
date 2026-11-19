import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ExecutionPlan, WorkCard } from '@/lib/api/internal';
import { workRowMenu } from '../../lib/workRowMenu';
import ExecutionWorkspace from './ExecutionWorkspace';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, listCustomerRequests: vi.fn() };
});

/** A Customer-scope work order: the company holds the service, nobody is behind it. */
const companyCard = (overrides: Partial<WorkCard> = {}): WorkCard =>
  ({
    name: 'WO-C',
    work_type: 'Service Action',
    operation_code: 'service.add',
    status: 'Pending',
    target_scope: 'Customer',
    subject_key: null,
    client_user: null,
    managed_device: null,
    service_item: 'DOM',
    service_name: 'Domain hosting',
    source_service_assignment: null,
    origin: 'Request',
    action_group_key: 'grp-dom',
    requirements: [],
    requested_client_user: null,
    requested_device: null,
    requested_holder_requested_client_user: null,
    display_status: 'Ready',
    failure_reason: null,
    target: { kind: 'customer', name: 'ACME', requested_entity: null, label: 'Acme Corp', sublabel: 'The company itself', badge: null },
    relationship: null,
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: true },
    prerequisite_action: null,
    dependency_label: null,
    current: null,
    device: null,
    ...overrides,
  }) as WorkCard;

const userCard = (): WorkCard =>
  companyCard({
    name: 'WO-U',
    target_scope: 'User',
    subject_key: 'user:CU-1',
    client_user: 'CU-1',
    target: { kind: 'client_user', name: 'CU-1', requested_entity: null, label: 'John Doe', sublabel: null, badge: null },
  });

const plan = (work: WorkCard[]): ExecutionPlan =>
  ({
    request: 'SR-0001',
    customer: 'ACME',
    status: 'In Progress',
    context: { requested_date: '2026-09-29' },
    recap: [],
    outcome: {},
    stages: { current: 'execute', stages: [] },
    action_groups: [
      {
        group_key: 'grp-dom',
        operation_code: 'service.add',
        label: 'Add Domain hosting',
        scope_label: null,
        origin: 'Customer',
        total: work.length,
        remaining: work.length,
        ready: work.length,
        needs_information: 0,
        by_status: {},
        work,
      },
    ],
    requested_entities: [],
    preparation: { new_people: 0, unresolved_devices: 0, missing_usernames: 0, missing_serials: 0 },
    people: work
      .filter((row) => row.target.kind === 'client_user')
      .map((row) => ({ subject_key: row.subject_key, client_user: row.client_user, full_name: row.target.label, remaining: 1 })),
    requirements: [],
    rejected: [],
    summary: {},
    activity: [],
  }) as unknown as ExecutionPlan;

const show = (value: ExecutionPlan) => {
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExecutionWorkspace plan={value} onSaved={() => undefined} onContinue={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('work held by the company itself on the Execute screen', () => {
  it('shows a Company section in the rail only when a company order exists', () => {
    show(plan([companyCard(), userCard()]));
    const rail = screen.getByRole('complementary', { name: 'Execution view' });

    expect(within(rail).getByRole('list', { name: 'Company' })).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /Acme Corp/ })).toBeTruthy();
    cleanup();

    show(plan([userCard()]));
    expect(screen.queryByRole('list', { name: 'Company' })).toBeNull();
  });

  it('selects the company work and names the company with no person or device', () => {
    show(plan([companyCard(), userCard()]));
    const rail = screen.getByRole('complementary', { name: 'Execution view' });

    fireEvent.click(within(rail).getByRole('button', { name: /Acme Corp/ }));

    const row = document.querySelector('[data-work-order="WO-C"]') as HTMLElement;
    expect(document.querySelector('[data-work-order="WO-U"]')).toBeNull();
    expect(within(row).getByText('Acme Corp')).toBeTruthy();
    expect(within(row).getByText('The company itself')).toBeTruthy();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeTruthy();
  });

  it('reads a quantity decrease, an increase and an addition under the action', () => {
    show(
      plan([
        companyCard({
          name: 'WO-DOWN',
          operation_code: 'service.change',
          source_service_assignment: 'SA-1',
          requested_quantity: 8,
          current: { quantity: 10 } as WorkCard['current'],
          primary_action: { operation_code: 'service.change', label: 'Change service', enabled: true },
        }),
        companyCard({
          name: 'WO-UP',
          operation_code: 'service.change',
          source_service_assignment: 'SA-1',
          requested_quantity: 12,
          current: { quantity: 10 } as WorkCard['current'],
          primary_action: { operation_code: 'service.change', label: 'Change service', enabled: true },
        }),
        companyCard({ name: 'WO-ADD', requested_quantity: 8 }),
      ])
    );

    const down = document.querySelector('[data-work-order="WO-DOWN"]') as HTMLElement;
    const up = document.querySelector('[data-work-order="WO-UP"]') as HTMLElement;
    const added = document.querySelector('[data-work-order="WO-ADD"]') as HTMLElement;

    expect(within(down).getByText('10 \u2192 8 (\u22122)')).toBeTruthy();
    expect(within(up).getByText('10 \u2192 12 (+2)')).toBeTruthy();
    expect(within(added).getByText('8')).toBeTruthy();
    expect(document.querySelectorAll('[data-work-order]')).toHaveLength(3);
    expect(within(down).getByRole('button', { name: 'Change service' })).toBeTruthy();
  });

  it('says nothing about a quantity where none was asked for', () => {
    show(
      plan([
        companyCard({ name: 'WO-SUSPEND', operation_code: 'service.suspend', requested_quantity: null }),
        companyCard({
          name: 'WO-MOVE',
          operation_code: 'service.change',
          source_service_assignment: 'SA-1',
          requested_quantity: null,
          current: { quantity: 10 } as WorkCard['current'],
        }),
        companyCard({
          name: 'WO-UNKNOWN',
          operation_code: 'service.change',
          source_service_assignment: 'SA-1',
          requested_quantity: 8,
          current: null,
        }),
      ])
    );

    expect(screen.queryByText(/\u2192/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('leaves a person\u2019s and a machine\u2019s work as it was', () => {
    const deviceCard = companyCard({
      name: 'WO-D',
      target_scope: 'Device',
      subject_key: 'device:DEV-1',
      managed_device: 'DEV-1',
      requested_quantity: 8,
      current: { quantity: 10 } as WorkCard['current'],
      target: { kind: 'managed_device', name: 'DEV-1', requested_entity: null, label: 'Laptop 7', sublabel: null, badge: null },
    });

    show(plan([userCard()]));

    const person = document.querySelector('[data-work-order="WO-U"]') as HTMLElement;

    expect(within(person).queryByText(/\u2192/)).toBeNull();
    expect(within(person).getByText('John Doe')).toBeTruthy();
    cleanup();

    show(plan([deviceCard]));

    const machine = document.querySelector('[data-work-order="WO-D"]') as HTMLElement;

    expect(within(machine).queryByText(/\u2192/)).toBeNull();
    expect(within(machine).getByText('Laptop 7')).toBeTruthy();
  });

  it('offers nothing person-only or machine-only on a company row', () => {
    const open = vi.fn();

    expect(workRowMenu(companyCard(), undefined, open)).toEqual({ kind: 'service', actions: [] });

    const held = workRowMenu(
      companyCard({
        operation_code: 'service.change',
        current: { operational_status: 'Active' } as WorkCard['current'],
        primary_action: { operation_code: 'service.change', label: 'Change service', enabled: true },
      }),
      undefined,
      open
    );
    const labels = held.kind === 'unresolved' ? [] : held.actions.map((action) => action.label);

    expect(labels).toEqual(expect.not.arrayContaining(['Assign device', 'Return to stock', 'Edit user']));
    expect(held.kind).toBe('service');
    expect(open).not.toHaveBeenCalled();
  });
});
