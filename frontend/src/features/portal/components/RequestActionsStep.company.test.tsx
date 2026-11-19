import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  RequestOperationDomain,
  RequestServiceOption,
  RequestTarget,
} from '@/lib/api/portal';
import RequestActionsStep from './RequestActionsStep';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

const operations = { data: { domains: [] as RequestOperationDomain[] }, isLoading: false };

vi.mock('../hooks/usePortal', () => ({
  useRequestScope: () => ({ data: { subjects: [] }, isLoading: false }),
  useRequestOperations: () => operations,
  usePortalSummary: () => ({ data: { customer: 'Nexgen SA' } }),
}));

type Builder = ReturnType<typeof useRequestBuilder>;

const target: RequestTarget = {
  subject_key: 'company',
  client_user: null,
  full_name: 'Nexgen SA',
  target_scope: 'Customer',
  managed_device: null,
  device_label: null,
  source_service_assignment: null,
};

const company = (): RequestOperationDomain => ({
  key: 'Company',
  label: 'The company itself',
  options: [
    {
      object_key: 'ITEM-STORAGE',
      object_label: 'Cloud Storage',
      service_scope: 'Customer',
      current_count: 0,
      without_count: 1,
      service_status_rows: [
        {
          subject_key: 'company',
          client_user: null,
          full_name: 'Nexgen SA',
          target_scope: 'Customer',
          managed_device: null,
          device_label: null,
          status: 'Not subscribed',
          status_since: null,
        },
      ],
      actions: [
        {
          operation_code: 'service.add',
          operation_label: 'Add',
          operation_label_snapshot: 'Add Cloud Storage',
          object_key: 'ITEM-STORAGE',
          object_label: 'Cloud Storage',
          targets: [target],
          exclusions: [],
          applicable_target_count: 1,
          applicable_subject_count: 1,
          excluded_subject_count: 0,
        },
      ],
    },
  ],
});

const act = (code: string, label: string) => ({
  operation_code: code,
  operation_label: label,
  operation_label_snapshot: `${label} Cloud Storage`,
  object_key: 'ITEM-STORAGE',
  object_label: 'Cloud Storage',
  targets: [{ ...target, source_service_assignment: 'SA-0001', current_quantity: 5 }],
  exclusions: [],
  applicable_target_count: 1,
  applicable_subject_count: 1,
  excluded_subject_count: 0,
});

/** The company already runs five of it, which is what a different quantity is asked against. */
const running = (): RequestOperationDomain => {
  const domain = company() as { key: 'Company'; label: string; options: RequestServiceOption[] };
  const card = domain.options[0];

  return {
    ...domain,
    options: [
      {
        ...card,
        current_count: 1,
        without_count: 0,
        current_quantity: 5,
        quantity_uom: 'TB',
        service_status_rows: [
          { ...card.service_status_rows[0], status: 'Active', status_since: '2026-01-01' },
        ],
        actions: [
          act('service.change', 'Update'),
          act('service.suspend', 'Suspend'),
          act('service.end', 'End'),
        ],
      },
    ],
  } as RequestOperationDomain;
};

const builder = (addActionGroup = vi.fn(), aboutCompany = true) =>
  ({
    subjects: [],
    subjectDrafts: [],
    groupDrafts: [],
    deviceDrafts: [],
    requestedDevices: [],
    actionGroups: [],
    editing: null,
    draft: null,
    // the company is on the request: it was picked in the People step like anybody else
    aboutCompany,
    addActionGroup,
  }) as unknown as Builder;

afterEach(() => {
  cleanup();
  operations.data = { domains: [] };
});

describe('RequestActionsStep, for the company itself', () => {
  it('offers a company service with nobody selected, and asks how much', () => {
    operations.data = { domains: [company()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(added).toHaveBeenCalledTimes(1);
    const group = added.mock.calls[0][0];

    expect(group.serviceItem).toBe('ITEM-STORAGE');
    expect(group.targets).toHaveLength(1);
    expect(group.targets[0].target_scope).toBe('Customer');
    expect(group.targets[0].requested_quantity).toBe(5);
    expect(group.targets[0].client_user).toBeNull();
  });

  it('refuses to ask for none of it', () => {
    operations.data = { domains: [company()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '0' },
    });

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
    expect(added).not.toHaveBeenCalled();
  });

  it('offers no company card when the server offers nothing for it', () => {
    render(<RequestActionsStep builder={builder()} />);

    // the rail still carries the company, because the request is about it; what is gone
    // is the card of services, which the server said nothing about
    expect(screen.queryByText('Nobody is named on these')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/How much of/)).not.toBeInTheDocument();
  });

  /**
   * Filtering a company service off the people's card is only half of it: the act has to
   * be offered to the one target that can hold it. It was simply gone otherwise.
   *
   * All selected shows all of it — the company's own services beside the people's — and
   * each card acts on the only target that can hold what it offers.
   */
  it('offers the company under All selected, and asks it of the company itself', () => {
    operations.data = { domains: [company()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added, false)} />);

    // it is offered although nobody put it on the request: the rail says as much
    expect(screen.getByText('Not on the request yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // asking something of it is what puts it on the request, as it is for a person
    expect(added).toHaveBeenCalledTimes(1);
    expect(added.mock.calls[0][0].targets[0].target_scope).toBe('Customer');
    expect(added.mock.calls[0][0].targets[0].requested_quantity).toBe(2);
  });
});

describe('asking for a different quantity of a company service', () => {
  it('starts from what is running rather than from one', () => {
    operations.data = { domains: [running()] };

    render(<RequestActionsStep builder={builder()} />);

    expect(screen.getByLabelText('How much of Cloud Storage')).toHaveValue(5);
    expect(screen.getByText(/Running 5/)).toBeInTheDocument();
  });

  it('offers Update beside Suspend and End', () => {
    operations.data = { domains: [running()] };

    render(<RequestActionsStep builder={builder()} />);

    for (const name of [/^update$/i, /^suspend$/i, /^end$/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('says how much the quantity would move, in the unit it is sold in', () => {
    operations.data = { domains: [running()] };

    render(<RequestActionsStep builder={builder()} />);
    const input = screen.getByLabelText('How much of Cloud Storage');

    fireEvent.change(input, { target: { value: '8' } });
    expect(screen.getByText('Increase by 3')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '3' } });
    expect(screen.getByText('Decrease by 2')).toBeInTheDocument();
  });

  it('will not ask for the quantity it already runs at', () => {
    operations.data = { domains: [running()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    expect(screen.getByText('No change to the quantity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^update$/i })).toBeDisabled();
    expect(added).not.toHaveBeenCalled();
  });

  it('will not ask for none of it', () => {
    operations.data = { domains: [running()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '0' },
    });

    expect(screen.getByText('Say how much is wanted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^update$/i })).toBeDisabled();
    expect(added).not.toHaveBeenCalled();
  });

  it('sends the new total as the requested quantity, on the change operation', () => {
    operations.data = { domains: [running()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));

    const group = added.mock.calls[0][0];

    expect(group.operationCode).toBe('service.change');
    expect(group.targets[0].requested_quantity).toBe(8);
    expect(group.targets[0].source_service_assignment).toBe('SA-0001');
    expect(group.targets[0].target_scope).toBe('Customer');
  });

  it('leaves Suspend and End alone whatever number is typed', () => {
    operations.data = { domains: [running()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^suspend$/i }));

    const group = added.mock.calls[0][0];

    expect(group.operationCode).toBe('service.suspend');
    expect(group.targets[0].requested_quantity).toBe(1);
  });

  it('does not switch the act when the quantity changes', () => {
    operations.data = { domains: [running()] };
    const added = vi.fn();

    render(<RequestActionsStep builder={builder(added)} />);

    fireEvent.change(screen.getByLabelText('How much of Cloud Storage'), {
      target: { value: '9' },
    });

    expect(screen.getByRole('button', { name: /^suspend$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^end$/i })).toBeEnabled();
    expect(added).not.toHaveBeenCalled();
  });
});
