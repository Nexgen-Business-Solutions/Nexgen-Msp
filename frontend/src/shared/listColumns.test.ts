import { beforeEach, describe, expect, it } from 'vitest';
import { defaultChoice, loadChoice, sectionsOf } from './exportColumns';
import {
  INTERNAL_DEVICE_LIST,
  INTERNAL_REQUEST_LIST,
  INTERNAL_SERVICE_LIST,
  INTERNAL_USER_LIST,
  LIST_LIMIT,
  PORTAL_DEVICE_LIST,
  PORTAL_USER_LIST,
} from './listColumns';

const LISTS = [
  INTERNAL_DEVICE_LIST,
  INTERNAL_USER_LIST,
  INTERNAL_REQUEST_LIST,
  INTERNAL_SERVICE_LIST,
  PORTAL_DEVICE_LIST,
  PORTAL_USER_LIST,
];

beforeEach(() => localStorage.clear());

describe('what every list may show', () => {
  it('starts within the limit, with the column that names the row', () => {
    for (const list of LISTS) {
      const { columns } = defaultChoice(list);
      const named = list.columns.filter((column) => column.required).map((column) => column.key);

      expect(list.limit, list.id).toBe(LIST_LIMIT);
      expect(columns.length, list.id).toBeLessThanOrEqual(LIST_LIMIT);
      for (const key of named) expect(columns, list.id).toContain(key);
    }
  });

  it('lays each picker out one section at a time', () => {
    for (const list of LISTS) {
      const sections = sectionsOf(list.columns);
      const seen = list.columns.map((column) => sections.indexOf(column.section));

      expect(seen, list.id).toEqual([...seen].sort((a, b) => a - b));
    }
  });

  it('never shows more than the limit, even from an old saved choice', () => {
    const everything = INTERNAL_DEVICE_LIST.columns.map((column) => column.key);
    localStorage.setItem(
      `msp:columns:${INTERNAL_DEVICE_LIST.id}`,
      JSON.stringify({ columns: everything, serviceColumns: [] })
    );

    const { columns } = loadChoice(INTERNAL_DEVICE_LIST);

    expect(columns).toHaveLength(LIST_LIMIT);
    expect(columns[0]).toBe('device');
  });

  it('keeps a list and its export apart', () => {
    expect(new Set(LISTS.map((list) => list.id)).size).toBe(LISTS.length);
    for (const list of LISTS) expect(list.id.startsWith('listing:'), list.id).toBe(true);
  });
});

describe('what a customer may show', () => {
  it('is exactly what we may show, without the customer column', () => {
    const ours = (list: typeof INTERNAL_USER_LIST) =>
      list.columns.filter((column) => column.key !== 'customer').map((column) => column.key);

    expect(PORTAL_USER_LIST.columns.map((column) => column.key)).toEqual(ours(INTERNAL_USER_LIST));
    expect(PORTAL_DEVICE_LIST.columns.map((column) => column.key)).toEqual(ours(INTERNAL_DEVICE_LIST));
    expect(PORTAL_USER_LIST.columns.some((column) => column.key === 'customer')).toBe(false);
  });
});

