import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeldDevice } from '@/lib/api/internal';
import HeldDeviceCard from './HeldDeviceCard';

describe('a held device service history', () => {
  it('shows ended services separately from services running now', () => {
    const slot: HeldDevice = {
      device: {
        name: 'DEV-1',
        hostname: 'LAPTOP-1',
        device_type: 'Laptop',
        status: 'Active',
        serial_number: 'SER-1',
        in_service_since: '2025-01-01',
      },
      holder_since: '2026-01-01',
      interfaces: [],
      services: {
        current: [],
        available: [],
        history: [
          {
            name: 'SA-OLD',
            service_item: 'OLD-AV',
            service_name: 'Legacy antivirus',
            operational_status: 'Ended',
            billing_status: 'Stopped',
            quantity: 1,
            effective_start_date: '2025-02-01',
            effective_end_date: '2025-12-31',
            source_request: null,
          },
        ],
      },
    };
    const noop = vi.fn();

    render(
      <HeldDeviceCard
        slot={slot}
        onAsk={noop}
        onAdd={noop}
        onApply={noop}
        onAddService={noop}
        onOpenRequest={noop}
        onOpenDevice={noop}
      />
    );

    const card = screen.getByText('LAPTOP-1').closest('section') as HTMLElement;
    expect(within(card).getByText('Service history')).toBeInTheDocument();
    expect(within(card).getByText('Legacy antivirus')).toBeInTheDocument();
    expect(within(card).getByText('2025-02-01 to 2025-12-31')).toBeInTheDocument();
  });
});
