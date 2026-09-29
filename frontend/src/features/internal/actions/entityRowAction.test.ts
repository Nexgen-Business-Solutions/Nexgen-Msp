import { describe, expect, it } from 'vitest';
import { Laptop } from 'lucide-react';
import { withoutOperation, type EntityRowAction } from '.';

const item = (label: string, extra: Partial<EntityRowAction> = {}): EntityRowAction => ({
  label,
  icon: Laptop,
  onClick: () => undefined,
  ...extra,
});

const ACTIONS = [
  item('Add service', { operationCode: 'service.add' }),
  item('Add service on LAPTOP-01', { operationCode: 'service.add', operationDevice: 'DEV-001' }),
  item('Edit'),
];

describe('withoutOperation', () => {
  it('returns the same list when nothing is excluded', () => {
    expect(withoutOperation(ACTIONS)).toBe(ACTIONS);
    expect(withoutOperation(ACTIONS, '')).toBe(ACTIONS);
  });

  it('removes the item that performs the operation on the entity itself only', () => {
    expect(withoutOperation(ACTIONS, 'service.add').map((action) => action.label)).toEqual([
      'Add service on LAPTOP-01',
      'Edit',
    ]);
  });

  it('keeps every item without an operation code', () => {
    expect(withoutOperation(ACTIONS, 'undefined').map((action) => action.label)).toEqual([
      'Add service',
      'Add service on LAPTOP-01',
      'Edit',
    ]);
  });
});
