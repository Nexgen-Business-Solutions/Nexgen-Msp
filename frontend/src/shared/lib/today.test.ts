import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { today } from './today';

/**
 * The date a form offers is the date the person is having.
 *
 * An hour either side of midnight, UTC is on another day. The form used to offer that one,
 * and a service was recorded as starting or ending on a day nobody chose. Each instant here
 * is built from local parts, so the day under test is the same day in every zone.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('today', () => {
  it('is the day it is locally half an hour after midnight', () => {
    // east of UTC, the UTC date is still the day before at this moment
    vi.setSystemTime(new Date(2026, 9, 28, 0, 30, 0));

    expect(today()).toBe('2026-10-28');
  });

  it('is still the day it is locally half an hour before midnight', () => {
    // west of UTC, the UTC date is already the day after at this moment
    vi.setSystemTime(new Date(2026, 9, 27, 23, 30, 0));

    expect(today()).toBe('2026-10-27');
  });

  it('pads the month and the day', () => {
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0));

    expect(today()).toBe('2026-01-05');
  });
});
