import { describe, expect, it, vi } from 'vitest';
import { CircleX, Laptop, Layers, PencilLine, Undo2, UserCheck, UserX } from 'lucide-react';
import {
  buildClientUserRowActions,
  type ClientUserRowActionsContext,
  type EntityRowAction,
} from '.';

const MACHINES = [
  { name: 'DEV-001', label: 'LAPTOP-01' },
  { name: 'DEV-002', label: 'SN-2' },
];

const context = (
  overrides: Partial<ClientUserRowActionsContext> = {}
): ClientUserRowActionsContext => ({
  lifecycleStatus: 'Active',
  canWrite: true,
  hasOpenPersonalServices: true,
  devices: [],
  onAddService: vi.fn(),
  onAssignDevice: vi.fn(),
  onAddServiceOnDevice: vi.fn(),
  onReturnDeviceToStock: vi.fn(),
  onEdit: vi.fn(),
  onChangeStatus: vi.fn(),
  onStopAllServices: vi.fn(),
  ...overrides,
});

const labels = (actions: EntityRowAction[]) => actions.map((action) => action.label);
const shown = (actions: EntityRowAction[]) =>
  actions.filter((action) => !action.disabled).map((action) => action.label);

const PER_MACHINE = [
  'Add service on LAPTOP-01',
  'Return LAPTOP-01 to stock',
  'Add service on SN-2',
  'Return SN-2 to stock',
];

const CODES = [
  'service.add',
  'service.suspend',
  'service.resume',
  'service.change',
  'service.end',
  'device.assign',
  'device.transfer',
  'device.repossess',
];

describe('buildClientUserRowActions', () => {
  it.each([
    [
      'Active',
      true,
      [],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
    ],
    [
      'Active',
      false,
      [],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
      ['Add service', 'Assign a device', 'Edit', 'Disable user'],
    ],
    [
      'Active',
      true,
      MACHINES,
      ['Add service', 'Assign a device', ...PER_MACHINE, 'Edit', 'Disable user', 'Stop all services'],
      ['Add service', 'Assign a device', ...PER_MACHINE, 'Edit', 'Disable user', 'Stop all services'],
    ],
    [
      'Disabled',
      true,
      [],
      ['Add service', 'Assign a device', 'Edit', 'Reactivate user', 'Stop all services'],
      ['Edit', 'Reactivate user', 'Stop all services'],
    ],
    [
      'Disabled',
      false,
      MACHINES,
      ['Add service', 'Assign a device', ...PER_MACHINE, 'Edit', 'Reactivate user', 'Stop all services'],
      [...PER_MACHINE, 'Edit', 'Reactivate user'],
    ],
    [
      'Archived',
      false,
      [],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
      ['Add service', 'Assign a device', 'Edit', 'Disable user'],
    ],
    [
      null,
      true,
      [],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
      ['Add service', 'Assign a device', 'Edit', 'Disable user', 'Stop all services'],
    ],
  ] as const)(
    'status %s, open personal services %s, machines %j',
    (lifecycleStatus, hasOpenPersonalServices, devices, all, visible) => {
      const actions = buildClientUserRowActions(
        context({ lifecycleStatus, hasOpenPersonalServices, devices: [...devices] })
      );

      expect(labels(actions)).toEqual(all);
      expect(shown(actions)).toEqual(visible);
    }
  );

  it.each(['Active', 'Disabled'])('gives a read-only viewer nothing (%s)', (lifecycleStatus) => {
    expect(
      buildClientUserRowActions(context({ canWrite: false, lifecycleStatus, devices: MACHINES }))
    ).toEqual([]);
  });

  it('keeps the icons, danger flags and operation codes of every item', () => {
    const actions = buildClientUserRowActions(context({ devices: [MACHINES[0]] }));

    expect(actions.map((action) => action.icon)).toEqual([
      Layers,
      Laptop,
      Layers,
      Undo2,
      PencilLine,
      UserX,
      CircleX,
    ]);
    expect(actions.map((action) => Boolean(action.danger))).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
      true,
    ]);
    expect(actions.map((action) => action.operationCode)).toEqual([
      'service.add',
      'device.assign',
      'service.add',
      'device.repossess',
      undefined,
      undefined,
      undefined,
    ]);
    expect(actions.map((action) => action.operationDevice)).toEqual([
      undefined,
      undefined,
      'DEV-001',
      'DEV-001',
      undefined,
      undefined,
      undefined,
    ]);

    const reactivate = buildClientUserRowActions(context({ lifecycleStatus: 'Disabled' })).find(
      (action) => action.label === 'Reactivate user'
    );
    expect(reactivate?.icon).toBe(UserCheck);
    expect(reactivate?.danger).toBeFalsy();
  });

  it('wires every item to its own callback, with the machine it names', () => {
    const ctx = context({ devices: MACHINES });
    const actions = buildClientUserRowActions(ctx);
    const click = (label: string) => actions.find((action) => action.label === label)?.onClick();

    click('Add service');
    click('Assign a device');
    click('Add service on SN-2');
    click('Return LAPTOP-01 to stock');
    click('Edit');
    click('Disable user');
    click('Stop all services');

    expect(ctx.onAddService).toHaveBeenCalledTimes(1);
    expect(ctx.onAssignDevice).toHaveBeenCalledTimes(1);
    expect(ctx.onAddServiceOnDevice).toHaveBeenCalledTimes(1);
    expect(ctx.onAddServiceOnDevice).toHaveBeenCalledWith('DEV-002');
    expect(ctx.onReturnDeviceToStock).toHaveBeenCalledTimes(1);
    expect(ctx.onReturnDeviceToStock).toHaveBeenCalledWith('DEV-001');
    expect(ctx.onEdit).toHaveBeenCalledTimes(1);
    expect(ctx.onChangeStatus).toHaveBeenCalledTimes(1);
    expect(ctx.onStopAllServices).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['service.add', 'Add service'],
    ['device.assign', 'Assign a device'],
  ])('excluding %s removes the person-level %s and nothing else', (code, label) => {
    const before = buildClientUserRowActions(context({ devices: MACHINES }));
    const after = buildClientUserRowActions(
      context({ devices: MACHINES, excludeOperationCode: code })
    );

    expect(labels(after)).toEqual(labels(before).filter((item) => item !== label));
    expect(after).toHaveLength(before.length - 1);
  });

  it.each([
    'device.repossess',
    'device.transfer',
    'service.suspend',
    'service.resume',
    'service.change',
    'service.end',
    'unknown',
    '',
  ])('excluding %j is a no-op, including on the machine items', (code) => {
    const before = buildClientUserRowActions(context({ devices: MACHINES }));
    const after = buildClientUserRowActions(
      context({ devices: MACHINES, excludeOperationCode: code })
    );

    expect(labels(after)).toEqual(labels(before));
  });

  it('never excludes Edit, Disable / Reactivate or Stop all services', () => {
    for (const lifecycleStatus of ['Active', 'Disabled']) {
      for (const code of CODES) {
        const kept = labels(
          buildClientUserRowActions(context({ lifecycleStatus, excludeOperationCode: code }))
        );

        expect(kept).toContain('Edit');
        expect(kept).toContain(lifecycleStatus === 'Disabled' ? 'Reactivate user' : 'Disable user');
        expect(kept).toContain('Stop all services');
      }
    }
  });

  it('offers no nested More actions item', () => {
    const actions = buildClientUserRowActions(context({ devices: MACHINES }));

    expect(labels(actions)).not.toContain('More actions');
  });
});
