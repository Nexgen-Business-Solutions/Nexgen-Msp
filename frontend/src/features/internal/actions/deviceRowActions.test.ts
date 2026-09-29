import { describe, expect, it, vi } from 'vitest';
import { ArrowRightLeft, Laptop, ShieldCheck, Undo2 } from 'lucide-react';
import { buildDeviceRowActions, type DeviceRowActionsContext, type EntityRowAction } from '.';

const context = (overrides: Partial<DeviceRowActionsContext> = {}): DeviceRowActionsContext => ({
  canWrite: true,
  onAddService: vi.fn(),
  onTransfer: vi.fn(),
  onReturnToStock: vi.fn(),
  onOpen: vi.fn(),
  ...overrides,
});

const labels = (actions: EntityRowAction[]) => actions.map((action) => action.label);
const shown = (actions: EntityRowAction[]) =>
  actions.filter((action) => !action.disabled).map((action) => action.label);

const FULL = ['Add service', 'Transfer to someone else', 'Return to stock', 'Open device'];
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

describe('buildDeviceRowActions', () => {
  it.each([
    [true, FULL],
    [false, ['Open device']],
  ] as const)('can write %s', (canWrite, expected) => {
    const actions = buildDeviceRowActions(context({ canWrite }));

    expect(labels(actions)).toEqual(expected);
    expect(shown(actions)).toEqual(expected);
  });

  it('keeps the icons, no danger flag and the operation codes of every item', () => {
    const actions = buildDeviceRowActions(context());

    expect(actions.map((action) => action.icon)).toEqual([
      ShieldCheck,
      ArrowRightLeft,
      Undo2,
      Laptop,
    ]);
    expect(actions.some((action) => action.danger)).toBe(false);
    expect(actions.map((action) => action.operationCode)).toEqual([
      'service.add',
      'device.transfer',
      'device.repossess',
      undefined,
    ]);
  });

  it('wires each item to its own callback and to nothing else', () => {
    const ctx = context();
    const actions = buildDeviceRowActions(ctx);
    const callbacks = [ctx.onAddService, ctx.onTransfer, ctx.onReturnToStock, ctx.onOpen];

    actions.forEach((action, index) => {
      action.onClick();
      callbacks.forEach((callback, position) =>
        expect(callback).toHaveBeenCalledTimes(position <= index ? 1 : 0)
      );
    });
  });

  it.each([
    ['service.add', 'Add service'],
    ['device.transfer', 'Transfer to someone else'],
    ['device.repossess', 'Return to stock'],
  ])('excluding %s removes %s and nothing else', (code, label) => {
    const after = buildDeviceRowActions(context({ excludeOperationCode: code }));

    expect(labels(after)).toEqual(FULL.filter((item) => item !== label));
  });

  it.each(['device.assign', 'service.end', 'service.suspend', 'unknown', ''])(
    'excluding %j is a no-op',
    (code) => {
      expect(labels(buildDeviceRowActions(context({ excludeOperationCode: code })))).toEqual(FULL);
    }
  );

  it('never excludes Open device, which is not a domain operation', () => {
    for (const code of CODES) {
      expect(labels(buildDeviceRowActions(context({ excludeOperationCode: code })))).toContain(
        'Open device'
      );
      expect(
        labels(buildDeviceRowActions(context({ canWrite: false, excludeOperationCode: code })))
      ).toEqual(['Open device']);
    }
  });
});
