import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RequestOperationDomain, RequestTarget } from '@/lib/api/portal';
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
