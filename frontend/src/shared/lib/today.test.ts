import { afterEach, describe, expect, it, vi } from 'vitest';
import { today } from './today';

/**
 * The date a form offers is the date the person is having.
 *
 * An hour either side of midnight, UTC is on another day. The form used to offer that one,
 * and a service was recorded as starting or ending on a day nobody chose.
 *
 * Each case names the zone it is read in, because a runner set to UTC has no such hour: the
 * old implementation would have satisfied the assertions there and proved nothing. The zone
 * is set before the instant is built, and each case checks that UTC really is on the other
 * day — so if a runtime ever stopped honouring the zone, these would say so rather than
 * pass quietly.
 */

const held = process.env.TZ;

afterEach(() => {
  process.env.TZ = held;
  vi.useRealTimers();
});

/** Noon-free: an instant built from local parts, in a named zone, with the clock frozen. */
const inZone = (zone: string, parts: [number, number, number, number, number]) => {
  process.env.TZ = zone;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(...parts));

  return new Date().toISOString().slice(0, 10);
};

describe('today', () => {
  it('is the local day half an hour after midnight, where UTC is still the day before', () => {
    const utcDay = inZone('Africa/Douala', [2026, 9, 28, 0, 30]);

    expect(utcDay).toBe('2026-10-27');
    expect(today()).toBe('2026-10-28');
  });

  it('is the local day half an hour before midnight, where UTC is already the day after', () => {
    const utcDay = inZone('America/Toronto', [2026, 9, 27, 23, 30]);

    expect(utcDay).toBe('2026-10-28');
    expect(today()).toBe('2026-10-27');
  });

  it('pads the month and the day', () => {
    inZone('Africa/Douala', [2026, 0, 5, 12, 0]);

    expect(today()).toBe('2026-01-05');
  });
});
