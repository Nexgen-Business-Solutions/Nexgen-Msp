import { describe, expect, it } from 'vitest';
import type { RequestDetailLine, WorkCard } from '@/lib/api/internal';
import { askedQuantity, quantityLine } from './workDisplay';

const card = (overrides: Partial<WorkCard> = {}): WorkCard =>
  ({
    name: 'WO-1',
    work_type: 'Service Action',
    operation_code: 'service.change',
    target_scope: 'Customer',
    source_service_assignment: 'SA-1',
    requested_quantity: 8,
    current: { quantity: 10 } as WorkCard['current'],
    ...overrides,
  }) as WorkCard;

const line = (overrides: Partial<RequestDetailLine> = {}): RequestDetailLine =>
  ({
    idx: 1,
    operation_code: 'service.change',
    target_scope: 'Customer',
    requested_quantity: 8,
    ...overrides,
  }) as RequestDetailLine;

describe('the quantity a company service order carries', () => {
  it('reads a decrease, an increase and an addition', () => {
    expect(quantityLine(card())).toBe('10 → 8 (−2)');
    expect(quantityLine(card({ requested_quantity: 12 }))).toBe('10 → 12 (+2)');
    expect(quantityLine(card({ operation_code: 'service.add', current: null, requested_quantity: 8 }))).toBe('8');
  });

  it('drops the trailing zeros a quantity was stored with', () => {
    expect(quantityLine(card({ current: { quantity: 10.5 } as WorkCard['current'], requested_quantity: 12 }))).toBe(
      '10.5 → 12 (+1.5)'
    );
  });

  it('names the quantity alone once the work has been carried out', () => {
    expect(quantityLine(card({ requested_quantity: 10 }))).toBe('10');
  });

  it('says nothing where no quantity was asked for', () => {
    expect(quantityLine(card({ requested_quantity: null }))).toBeNull();
    expect(quantityLine(card({ current: null }))).toBeNull();
    expect(quantityLine(card({ operation_code: 'service.suspend' }))).toBeNull();
    expect(quantityLine(card({ target_scope: 'User' }))).toBeNull();
  });
});

describe('the quantity a request line asks for', () => {
  it('names the new total of a change and the amount of an addition', () => {
    expect(askedQuantity(line())).toBe('→ 8');
    expect(askedQuantity(line({ operation_code: 'service.add' }))).toBe('8');
  });

  it('says nothing where the line names no quantity', () => {
    expect(askedQuantity(undefined)).toBeNull();
    expect(askedQuantity(line({ requested_quantity: 0 }))).toBeNull();
    expect(askedQuantity(line({ operation_code: 'service.suspend' }))).toBeNull();
    expect(askedQuantity(line({ target_scope: 'User' }))).toBeNull();
  });
});
