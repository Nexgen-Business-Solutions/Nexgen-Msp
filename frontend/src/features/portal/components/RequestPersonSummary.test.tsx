import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import type { RequestSubjectRow } from '@/lib/api/portal';
import RequestPersonSummary from './RequestPersonSummary';

const person = (overrides: Partial<RequestSubjectRow> = {}): RequestSubjectRow => ({
  subject_key: 'user:CU-1',
  kind: 'existing',
  client_user: 'CU-1',
  requested_client_user: null,
  full_name: 'Idriss Kante',
  department: 'Accounting',
  email: 'idriss@example.invalid',
  username: 'ikante',
  added_via: 'Existing',
  selection_label: null,
  devices: [
    {
      name: 'DEV-1',
      label: 'KV-ONE',
      status: 'Active',
      hostname: 'KV-ONE',
      device_type: 'PC',
      serial_number: 'SN-1',
    },
    {
      name: 'DEV-2',
      label: 'KV-TWO',
      status: 'Active',
      hostname: 'KV-TWO',
      device_type: 'Laptop',
      serial_number: null,
    },
  ],
  current_services: [
    {
      assignment: 'SA-1',
      service_item: 'SOPHOS',
      label: 'Sophos',
      scope: 'Device',
      status: 'Active',
      managed_device: 'DEV-1',
    },
  ],
  last_billed: null,
  usable: true,
  reason_code: null,
  ...overrides,
});

describe('the person an act is being built for', () => {
  it('shows who they are', () => {
    const { container } = render(<RequestPersonSummary person={person()} />);
    const details = within(container).getByRole('region', { name: 'Idriss Kante details' });

    expect(within(details).getByText('Accounting')).toBeInTheDocument();
    expect(within(details).getByText('idriss@example.invalid')).toBeInTheDocument();
    expect(within(details).getByText('ikante')).toBeInTheDocument();
    expect(within(details).getByText('CU-1')).toBeInTheDocument();
  });

  it('lists each machine they hold with its hostname and its type', () => {
    const { container } = render(<RequestPersonSummary person={person()} />);
    const rows = within(container).getAllByRole('row').slice(1);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('KV-ONE')).toBeInTheDocument();
    expect(within(rows[0]).getByText('PC')).toBeInTheDocument();
    expect(within(rows[0]).getByText('SN-1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Sophos')).toBeInTheDocument();
    expect(within(rows[1]).getByText('KV-TWO')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Laptop')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Sophos')).not.toBeInTheDocument();
  });

  it('says so when they hold nothing, and that they are still to be created', () => {
    const { container } = render(
      <RequestPersonSummary
        person={person({ kind: 'new', client_user: null, username: null, devices: [] })}
      />
    );

    expect(within(container).getByText('No Device.')).toBeInTheDocument();
    expect(within(container).getByText('New person')).toBeInTheDocument();
  });
});
