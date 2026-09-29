import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkCard } from '@/lib/api/internal';
import EffectiveDateModal from './EffectiveDateModal';

vi.mock('../../hooks/useRequests', () => ({
  useSelectableClientUsers: () => ({ data: undefined }),
}));

const card = (name: string, effective_date: string | null = null) =>
  ({
    name,
    operation_code: 'service.add',
    effective_date,
    target: { label: `Target ${name}` },
    current: null,
  }) as unknown as WorkCard;

const show = ({
  cards = [card('WO-1')],
  requestedDate = null as string | null,
  createdOn = null as string | null,
  onConfirm = vi.fn(),
} = {}) => {
  render(
    <EffectiveDateModal
      title="Add service"
      subtitle="Helen"
      cards={cards}
      requestedDate={requestedDate}
      createdOn={createdOn}
      busy={false}
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );

  return {
    input: screen.getByLabelText('Effective date') as HTMLInputElement,
    confirm: screen.getByRole('button', { name: 'Add service' }),
    onConfirm,
  };
};

describe('EffectiveDateModal', () => {
  afterEach(cleanup);

  it('opens on the date the request asked for when it is on or after the creation day', () => {
    const { input } = show({ requestedDate: '2026-11-15', createdOn: '2026-09-29 10:12:00.000000' });

    expect(input.value).toBe('2026-11-15');
    expect(input.min).toBe('2026-09-29');
  });

  it('opens on the creation day when an older request asked for a day before it', () => {
    const { input } = show({ requestedDate: '2026-09-01', createdOn: '2026-09-10 08:00:00' });

    expect(input.value).toBe('2026-09-10');
    expect(input.min).toBe('2026-09-10');
  });

  it('opens on the creation day when the work itself was dated before it', () => {
    const { input } = show({
      cards: [card('WO-1', '2026-09-03')],
      requestedDate: '2026-09-03',
      createdOn: '2026-09-05 17:40:00',
    });

    expect(input.value).toBe('2026-09-05');
  });

  it('does not carry out a day before the creation day, and says nothing more about it', () => {
    const { input, confirm, onConfirm } = show({
      requestedDate: '2026-10-01',
      createdOn: '2026-09-20 09:00:00',
    });

    fireEvent.change(input, { target: { value: '2026-09-19' } });

    expect(confirm).toBeDisabled();
    expect(screen.queryByText(/before the request was created/i)).toBeNull();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '2026-09-20' } });
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith('2026-09-20', new Set());
  });

  it('carries out a future day chosen in the dialog', () => {
    const { input, confirm, onConfirm } = show({
      requestedDate: '2026-09-29',
      createdOn: '2026-09-29 11:00:00',
    });

    fireEvent.change(input, { target: { value: '2027-01-04' } });
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith('2027-01-04', new Set());
  });

  it('keeps no floor when the creation day is not known', () => {
    const { input } = show({ requestedDate: '2026-08-01' });

    expect(input.value).toBe('2026-08-01');
    expect(input.min).toBe('');
  });
});
