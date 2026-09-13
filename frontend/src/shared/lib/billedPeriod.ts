import { FrappeError } from '@/lib/api/client';

/** The server's way of saying: this day was already invoiced, confirm to go ahead anyway. */
export const BILLED_PERIOD = 'BILLED_PERIOD';

export const isBilledPeriod = (error: unknown): error is FrappeError =>
  error instanceof FrappeError && error.code === BILLED_PERIOD;
