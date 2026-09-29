import { describe, expect, it, vi } from 'vitest';
import { CircleX, PauseCircle, PencilLine, PlayCircle } from 'lucide-react';
import {
  buildServiceAssignmentRowActions,
  type EntityRowAction,
  type ServiceAssignmentRowActionsContext,
} from '.';

const context = (
  overrides: Partial<ServiceAssignmentRowActionsContext> = {}
): ServiceAssignmentRowActionsContext => ({
  status: 'Active',
  canWrite: true,
  onSuspend: vi.fn(),
  onResume: vi.fn(),
  onChange: vi.fn(),
  onEnd: vi.fn(),
  ...overrides,
});

const labels = (actions: EntityRowAction[]) => actions.map((action) => action.label);
const shown = (actions: EntityRowAction[]) =>
  actions.filter((action) => !action.disabled).map((action) => action.label);

const FULL = ['Suspend', 'Resume', 'Change service', 'Stop service'];

describe('buildServiceAssignmentRowActions', () => {
  it.each([
    ['Active', true, true, FULL, ['Suspend', 'Change service', 'Stop service']],
    ['Suspended', true, true, FULL, ['Resume', 'Change service', 'Stop service']],
    ['Pending Setup', true, true, FULL, []],
    ['Ended', true, true, FULL, []],
    ['Cancelled', true, true, FULL, []],
    ['Active', false, true, [], []],
    ['Suspended', false, true, [], []],
    ['Ended', false, true, [], []],
    ['Active', true, false, [], []],
    ['Suspended', true, false, [], []],
    ['Active', false, false, [], []],
  ] as const)(
    'status %s, can write %s, current holding %s',
    (status, canWrite, currentHolding, all, visible) => {
      const actions = buildServiceAssignmentRowActions(
        context({ status, canWrite, currentHolding })
      );

      expect(labels(actions)).toEqual(all);
      expect(shown(actions)).toEqual(visible);
    }
  );

  it('treats a missing current holding flag as the current holding', () => {
    const actions = buildServiceAssignmentRowActions(context({ currentHolding: undefined }));

    expect(labels(actions)).toEqual(FULL);
  });

  it('keeps the icons, the danger flag and the operation codes of every item', () => {
    const actions = buildServiceAssignmentRowActions(context());

    expect(actions.map((action) => action.icon)).toEqual([
      PauseCircle,
      PlayCircle,
      PencilLine,
      CircleX,
    ]);
    expect(actions.map((action) => Boolean(action.danger))).toEqual([false, false, false, true]);
    expect(actions.map((action) => action.operationCode)).toEqual([
      'service.suspend',
      'service.resume',
      'service.change',
      'service.end',
    ]);
    expect(actions.every((action) => action.operationDevice === undefined)).toBe(true);
  });

  it('wires each item to its own callback and to nothing else', () => {
    const ctx = context();
    const actions = buildServiceAssignmentRowActions(ctx);
    const callbacks = [ctx.onSuspend, ctx.onResume, ctx.onChange, ctx.onEnd];

    actions.forEach((action, index) => {
      action.onClick();
      callbacks.forEach((callback, position) =>
        expect(callback).toHaveBeenCalledTimes(position <= index ? 1 : 0)
      );
    });
  });

  it.each([
    ['service.suspend', 'Suspend'],
    ['service.resume', 'Resume'],
    ['service.change', 'Change service'],
    ['service.end', 'Stop service'],
  ])('excluding %s removes %s and nothing else', (code, label) => {
    for (const status of ['Active', 'Suspended', 'Ended']) {
      const before = buildServiceAssignmentRowActions(context({ status }));
      const after = buildServiceAssignmentRowActions(
        context({ status, excludeOperationCode: code })
      );

      expect(labels(after)).toEqual(labels(before).filter((item) => item !== label));
      expect(after).toHaveLength(before.length - 1);
      expect(after.map((action) => action.disabled)).toEqual(
        before.filter((action) => action.label !== label).map((action) => action.disabled)
      );
    }
  });

  it.each(['service.add', 'device.assign', 'device.transfer', 'device.repossess', 'unknown', ''])(
    'excluding %j is a no-op',
    (code) => {
      const before = buildServiceAssignmentRowActions(context());
      const after = buildServiceAssignmentRowActions(context({ excludeOperationCode: code }));

      expect(labels(after)).toEqual(labels(before));
    }
  );

  it('gives a read-only viewer nothing, whatever is excluded', () => {
    expect(
      buildServiceAssignmentRowActions(
        context({ canWrite: false, excludeOperationCode: 'service.suspend' })
      )
    ).toEqual([]);
  });
});
