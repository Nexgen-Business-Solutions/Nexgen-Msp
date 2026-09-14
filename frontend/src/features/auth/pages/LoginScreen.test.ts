import { describe, expect, it } from 'vitest';
import { safeMspRedirect } from '../authRedirect';

describe('the post-login return path', () => {
  it.each(['/msp', '/msp/requests/REQ-1', '/msp?focus=open', '/msp#requests'])(
    'accepts the internal path %s',
    (path) => expect(safeMspRedirect(path)).toBe(path)
  );

  it.each([
    'https://attacker.example',
    '//attacker.example',
    '/msphishing.example',
    '/msp\\attacker.example',
    'javascript:alert(1)',
    undefined,
  ])('falls back safely for %s', (path) => {
    expect(safeMspRedirect(path)).toBe('/msp');
  });
});
