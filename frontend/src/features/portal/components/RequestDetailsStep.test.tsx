import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { format } from 'date-fns';
import RequestDetailsStep from './RequestDetailsStep';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const builder = (requestedDate = '') =>
  ({
    requestedDate,
    setRequestedDate: vi.fn(),
    priority: 'Medium',
    setPriority: vi.fn(),
    details: '',
    setDetails: vi.fn(),
  }) as unknown as Builder;

describe('RequestDetailsStep', () => {
  afterEach(cleanup);

  it('does not offer a requested date before today', () => {
    render(<RequestDetailsStep builder={builder()} />);

    expect((screen.getByLabelText('Requested date') as HTMLInputElement).min).toBe(
      format(new Date(), 'yyyy-MM-dd')
    );
  });

  it('keeps the date a draft was saved with', () => {
    render(<RequestDetailsStep builder={builder('2027-02-01')} />);

    expect((screen.getByLabelText('Requested date') as HTMLInputElement).value).toBe('2027-02-01');
  });
});
