import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import RequestDevicePicker from './RequestDevicePicker';

const shown = vi.hoisted(() => ({ total: 2, truncated: false }));

vi.mock('../hooks/usePortal', () => ({
  useSelectableDevices: () => ({
    isLoading: false,
    data: {
      total: shown.total,
      truncated: shown.truncated,
      rows: [
        {
          name: 'DEV-1',
          hostname: 'KV-ONE',
          serial_number: 'SN-1',
          device_type: 'PC',
          status: 'Active',
          asset_tag: null,
          current_holder: 'CU-9',
          current_holder_name: 'Nawaz',
          selectable: true,
          unavailable_reason: null,
        },
        {
          name: 'DEV-2',
          hostname: 'KV-TWO',
          serial_number: null,
          device_type: 'Laptop',
          status: 'Stock',
          asset_tag: null,
          current_holder: null,
          current_holder_name: null,
          selectable: true,
          unavailable_reason: null,
        },
      ],
    },
  }),
}));

afterEach(() => {
  cleanup();
  shown.total = 2;
  shown.truncated = false;
});

describe('choosing a machine for somebody', () => {
  it('cannot give a machine that this request already hands to somebody else', () => {
    const onPick = vi.fn();

    render(
      <RequestDevicePicker
        taken={new Map([['DEV-2', 'Helen']])}
        onClose={() => {}}
        onPick={onPick}
      />
    );
    const screen = within(document.body);

    expect(screen.getByRole('button', { name: 'Choose KV-TWO' })).toBeDisabled();
    expect(screen.getByText('Already asked for Helen in this request.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Choose KV-ONE' }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].name).toBe('DEV-1');
  });

  it('offers every machine when nothing is taken, a held one included', () => {
    render(<RequestDevicePicker onClose={() => {}} onPick={() => {}} />);
    const screen = within(document.body);

    expect(screen.getByRole('button', { name: 'Choose KV-ONE' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose KV-TWO' })).toBeEnabled();
  });

  it('says when the list is cut, and only then', () => {
    render(<RequestDevicePicker onClose={() => {}} onPick={() => {}} />);
    expect(within(document.body).queryByText(/Refine your search/)).not.toBeInTheDocument();
    cleanup();

    shown.total = 120;
    shown.truncated = true;
    render(<RequestDevicePicker onClose={() => {}} onPick={() => {}} />);
    expect(
      within(document.body).getByText('Showing the first 2 of 120. Refine your search.')
    ).toBeInTheDocument();
  });
});
