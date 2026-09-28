import { describe, expect, it } from 'vitest';
import type { RequestTarget } from '@/lib/api/portal';
import { askedAmong, askedFrom, askedIndex, keyOf } from './askedScope';

const person = (key: string, device?: string): RequestTarget =>
  ({
    subject_key: key,
    client_user: key,
    managed_device: device ?? null,
    source_service_assignment: null,
  }) as unknown as RequestTarget;

describe('what a request already asks for', () => {
  it('counts nothing when the scope on screen is somebody else', () => {
    const index = askedIndex([
      { operationCode: 'device.assign', targets: [person('CU-1'), person('CU-2')] },
    ]);

    expect(askedFrom(index, 'device.assign').size, 'the request does hold two').toBe(2);
    expect(
      askedAmong(index, [person('CU-9')], 'device.assign'),
      'the badge is about the people in front of you, not the request'
    ).toBe(0);
  });

  it('counts only the part of the scope that is already asked for', () => {
    const index = askedIndex([{ operationCode: 'device.assign', targets: [person('CU-2')] }]);

    expect(askedAmong(index, [person('CU-1'), person('CU-2'), person('CU-3')], 'device.assign')).toBe(
      1
    );
  });

  it('keeps two acts on the same people apart', () => {
    const index = askedIndex([
      { operationCode: 'device.assign', targets: [person('CU-1')] },
      { operationCode: 'device.remove', targets: [person('CU-1')] },
    ]);

    expect(askedAmong(index, [person('CU-1')], 'device.assign')).toBe(1);
    expect(askedAmong(index, [person('CU-1')], 'device.transfer')).toBe(0);
  });

  it('keeps the same act on two different services apart', () => {
    const index = askedIndex([
      { operationCode: 'service.add', serviceItem: 'M365-E3', targets: [person('CU-1')] },
    ]);

    expect(askedAmong(index, [person('CU-1')], 'service.add', 'M365-E3')).toBe(1);
    expect(
      askedAmong(index, [person('CU-1')], 'service.add', 'M365-E5'),
      'asking for one licence is not asking for another'
    ).toBe(0);
  });

  it('tells two machines of one person apart', () => {
    const index = askedIndex([
      { operationCode: 'device.remove', targets: [person('CU-1', 'MD-1')] },
    ]);

    expect(askedAmong(index, [person('CU-1', 'MD-1')], 'device.remove')).toBe(1);
    expect(
      askedAmong(index, [person('CU-1', 'MD-2')], 'device.remove'),
      'the same person, the other laptop'
    ).toBe(0);
  });

  it('does not double-count one target added twice', () => {
    const index = askedIndex([
      { operationCode: 'device.assign', targets: [person('CU-1')] },
      { operationCode: 'device.assign', targets: [person('CU-1')] },
    ]);

    expect(askedAmong(index, [person('CU-1')], 'device.assign')).toBe(1);
  });

  it('separates a person from that person plus a machine', () => {
    expect(keyOf(person('CU-1'))).not.toBe(keyOf(person('CU-1', 'MD-1')));
  });
});
