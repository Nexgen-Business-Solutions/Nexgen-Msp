import { describe, expect, it } from 'vitest';
import type { RequestTarget } from '@/lib/api/portal';
import { machineOf, machinesTaken, takenReason } from './machinesTaken';

const target = (overrides: Partial<RequestTarget>): RequestTarget =>
  ({
    subject_key: 'user:CU-1',
    client_user: 'CU-1',
    full_name: 'Helen',
    target_scope: 'Device',
    managed_device: null,
    device_label: null,
    source_service_assignment: null,
    ...overrides,
  }) as RequestTarget;

const people = [
  { key: 'user:CU-1', clientUser: 'CU-1', fullName: 'Helen' },
  { key: 'new:marie', clientUser: null, fullName: 'Marie' },
];

describe('the machines a request already hands to somebody', () => {
  it('names who a machine was asked for', () => {
    const taken = machinesTaken(
      [{ operationCode: 'device.assign', targets: [target({ managed_device: 'DEV-1' })] }],
      people
    );

    expect(taken.get('DEV-1')).toBe('Helen');
    expect(takenReason(taken.get('DEV-1') ?? '')).toBe('Already asked for Helen in this request.');
  });

  it('names who receives a machine that changes holder, a future person included', () => {
    const taken = machinesTaken(
      [
        {
          operationCode: 'device.transfer',
          targets: [
            target({ managed_device: 'DEV-2', requested_holder_subject_key: 'new:marie' }),
            target({ managed_device: 'DEV-3', requested_holder: 'CU-1' }),
          ],
        },
      ],
      people
    );

    expect(taken.get('DEV-2')).toBe('Marie');
    expect(taken.get('DEV-3')).toBe('Helen');
  });

  it('counts a requested machine like one on file', () => {
    const taken = machinesTaken(
      [
        {
          operationCode: 'device.assign',
          targets: [target({ device_requirement_key: 'new-device:a' })],
        },
      ],
      people
    );

    expect(taken.has('new-device:a')).toBe(true);
  });

  it('leaves alone a machine that is only sent back to stock or given a service', () => {
    const taken = machinesTaken(
      [
        { operationCode: 'device.repossess', targets: [target({ managed_device: 'DEV-4' })] },
        { operationCode: 'service.add', targets: [target({ managed_device: 'DEV-5' })] },
      ],
      people
    );

    expect(taken.size).toBe(0);
  });

  it('takes nothing for a machine that was asked for without being named', () => {
    expect(machineOf(target({}))).toBeNull();
    expect(
      machinesTaken([{ operationCode: 'device.assign', targets: [target({})] }], people).size
    ).toBe(0);
  });

  it('says so plainly when the receiver is not known', () => {
    expect(takenReason('')).toBe('Already handed over in this request.');
  });
});
