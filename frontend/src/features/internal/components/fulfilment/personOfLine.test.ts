import { describe, expect, it } from 'vitest';
import type { RequestDetailLine } from '@/lib/api/internal';
import { keyOfPerson, nameOfPerson, recordOfPerson } from './personOfLine';

const asked = (overrides: Partial<RequestDetailLine>) =>
  ({
    idx: 1,
    is_new_user: 0,
    client_user: null,
    client_user_name: null,
    requested_for_user: null,
    device_holder: null,
    new_user_full_name: null,
    subject_key: null,
    ...overrides,
  }) as unknown as RequestDetailLine;

const newcomer = (idx: number, holder: string) =>
  asked({
    idx,
    is_new_user: 1,
    subject_key: 'new-user:idriss kante',
    new_user_full_name: 'Idriss kante',
    device_holder: holder,
  });

describe('who a request line is for', () => {
  it('keeps one newcomer as one person, whatever machines they are given', () => {
    const first = newcomer(1, 'CU-900');
    const second = newcomer(2, 'CU-901');

    expect(keyOfPerson(first)).toBe(keyOfPerson(second));
    expect(keyOfPerson(first)).not.toBe('CU-900');
  });

  it('never calls a newcomer by the name of whoever holds the machine today', () => {
    expect(nameOfPerson(newcomer(1, 'CU-900'))).toBe('Idriss kante');
    expect(recordOfPerson(newcomer(1, 'CU-900'))).toBeNull();
  });

  it('tells two newcomers apart even when the request named them the same', () => {
    const one = asked({ idx: 1, is_new_user: 1, subject_key: 'new:a', new_user_full_name: 'Sam' });
    const two = asked({ idx: 2, is_new_user: 1, subject_key: 'new:b', new_user_full_name: 'Sam' });

    expect(keyOfPerson(one)).not.toBe(keyOfPerson(two));
  });

  it('reads an existing person by their record', () => {
    const line = asked({ client_user: 'CU-1', client_user_name: 'Helen', device_holder: 'CU-9' });

    expect(keyOfPerson(line)).toBe('CU-1');
    expect(nameOfPerson(line)).toBe('Helen');
    expect(recordOfPerson(line)).toBe('CU-1');
  });

  it('falls back to the machine holder only for a line that names nobody', () => {
    const line = asked({ device_holder: 'CU-9' });

    expect(keyOfPerson(line)).toBe('CU-9');
    expect(recordOfPerson(line)).toBe('CU-9');
  });

  it('follows a newcomer once the request has created them', () => {
    const line = asked({ idx: 1, is_new_user: 1, client_user: 'CU-77', client_user_name: 'Idriss' });

    expect(keyOfPerson(line), 'they have a record now, and it is theirs').toBe('CU-77');
    expect(nameOfPerson(line)).toBe('Idriss');
  });
});
