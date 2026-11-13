import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { today } from '@/shared/lib/today';
import ServiceState from './ServiceState';

/**
 * Issue #39: a pause recorded for a day still to come flipped the record to Suspended at
 * once, so the screen said a service was paused while it was running and being billed.
 */
afterEach(cleanup);

describe('ServiceState', () => {
  it('says from when, for a pause that has not started', () => {
    render(<ServiceState status="Suspended" suspendedFrom="2099-12-01" />);

    expect(screen.getByText('SUSPENDED')).toBeInTheDocument();
    expect(screen.getByText('from 2099-12-01')).toBeInTheDocument();
  });

  it('says nothing more once the pause has taken effect', () => {
    render(<ServiceState status="Suspended" suspendedFrom="2020-01-01" />);

    expect(screen.getByText('SUSPENDED')).toBeInTheDocument();
    expect(screen.queryByText(/^from /)).not.toBeInTheDocument();
  });

  it('says nothing more for a pause starting today', () => {
    render(<ServiceState status="Suspended" suspendedFrom={today()} />);

    expect(screen.queryByText(/^from /)).not.toBeInTheDocument();
  });

  it('leaves every other state alone', () => {
    render(<ServiceState status="Active" suspendedFrom="2099-12-01" />);

    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.queryByText(/^from /)).not.toBeInTheDocument();
  });
});
