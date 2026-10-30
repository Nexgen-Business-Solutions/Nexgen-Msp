import { describe, expect, it } from 'vitest';
import type { SessionContext } from '@/lib/api/session';
import { isInternal, keepRequested, landingFor } from './landing';

/**
 * Where a signed-in account goes.
 *
 * Two separate jobs: a route somebody asked for must not carry them out of the destination
 * they were granted, and a destination the server refused must not be navigated to anyway.
 */

const withDestination = (over: Partial<SessionContext['login_destination']> = {}) =>
  ({
    login_destination: {
      success: true,
      rule: 'Nexgen MSP',
      source: 'role',
      path: '/msp',
      error: null,
      ...over,
    },
  }) as SessionContext;

describe('a route somebody asked for', () => {
  it.each(['/msp', '/msp/requests/REQ-1', '/msp?focus=open', '/msp#requests'])(
    'is honoured inside its own destination: %s',
    (path) => expect(keepRequested(path, '/msp')).toBe(path)
  );

  it.each([
    'https://attacker.example',
    '//attacker.example',
    '/msphishing.example',
    '/msp\\attacker.example',
    'javascript:alert(1)',
    undefined,
  ])('falls back to the destination for %s', (path) =>
    expect(keepRequested(path, '/msp')).toBe('/msp')
  );

  it('is dropped when it belongs to another destination', () => {
    expect(keepRequested('/desk/billing', '/msp')).toBe('/msp');
    expect(keepRequested('/msp/billing', '/desk')).toBe('/desk');
  });

  it('is honoured below the destination it does belong to', () => {
    expect(keepRequested('/desk/todo', '/desk')).toBe('/desk/todo');
  });
});

describe('where a session lands', () => {
  it('goes to the destination the server authorised', () => {
    expect(landingFor(withDestination({ path: '/desk' }))).toEqual({ path: '/desk', code: null });
  });

  it('keeps a deep link that belongs to that destination', () => {
    expect(landingFor(withDestination(), '/msp/devices').path).toBe('/msp/devices');
  });

  it('refuses a deep link that would cross into another destination', () => {
    expect(landingFor(withDestination({ path: '/desk' }), '/msp/billing').path).toBe('/desk');
  });

  it('sends a refused destination to the denial screen, carrying why', () => {
    expect(
      landingFor(withDestination({ success: false, path: null, error: 'NO_LOGIN_RULE' }))
    ).toEqual({ path: '/msp/unauthorized', code: 'NO_LOGIN_RULE' });
  });

  it('lands in the application when the server is not routing by rules yet', () => {
    expect(landingFor({} as SessionContext, '/msp/requests')).toEqual({
      path: '/msp/requests',
      code: null,
    });
  });
});

describe('whether a destination can be reached without leaving the page', () => {
  it.each(['/msp', '/msp/billing', '/msp?tab=1'])('%s is ours', (path) =>
    expect(isInternal(path)).toBe(true)
  );

  it.each(['/desk', '/app', '/mspother'])('%s is not', (path) =>
    expect(isInternal(path)).toBe(false)
  );
});
