import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assignDevice,
  reinstateDevice,
  repossessDevice,
  retireDevice,
  transferDevice,
} from './internal';

const jsonResponse = (message: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ message }),
});

const outcome = {
  name: 'DEV-001',
  hostname: 'LAPTOP-01',
  status: 'Active',
  assigned_client_user: null,
};

const lastRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: String(url), body: JSON.parse((options as RequestInit).body as string) };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device lifecycle API payloads', () => {
  it('posts every field for assignDevice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await assignDevice({
      device: 'DEV-001',
      client_user: 'USR-001',
      effective_date: '2024-01-01',
      note: 'onboarding',
    });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toContain('assign_device');
    expect(body).toEqual({
      device: 'DEV-001',
      client_user: 'USR-001',
      effective_date: '2024-01-01',
      note: 'onboarding',
    });
  });

  it('posts every field for transferDevice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await transferDevice({
      device: 'DEV-001',
      client_user: 'USR-002',
      effective_date: '2024-02-01',
      note: 'handover',
    });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toContain('transfer_device');
    expect(body).toEqual({
      device: 'DEV-001',
      client_user: 'USR-002',
      effective_date: '2024-02-01',
      note: 'handover',
    });
  });

  it('posts repossessDevice with no client_user field at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await repossessDevice({ device: 'DEV-001', effective_date: '2024-03-01', note: 'back to stock' });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toContain('repossess_device');
    expect(body).toEqual({
      device: 'DEV-001',
      effective_date: '2024-03-01',
      note: 'back to stock',
    });
    expect('client_user' in body).toBe(false);
  });

  it('posts retireDevice with no client_user field at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await retireDevice({ device: 'DEV-001', effective_date: '2024-04-01', note: 'end of life' });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toContain('retire_device');
    expect(body).toEqual({
      device: 'DEV-001',
      effective_date: '2024-04-01',
      note: 'end of life',
    });
    expect('client_user' in body).toBe(false);
  });

  it('sends reinstateDevice without a client_user key when returning to stock, not an empty string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await reinstateDevice({
      device: 'DEV-001',
      effective_date: '2024-05-01',
      client_user: undefined,
      note: 'back in service',
    });

    const { url, body } = lastRequest(fetchMock);
    expect(url).toContain('reinstate_device');
    expect('client_user' in body).toBe(false);
    expect(body).toEqual({
      device: 'DEV-001',
      effective_date: '2024-05-01',
      note: 'back in service',
    });
  });

  it('sends reinstateDevice with client_user when assigning immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(outcome));
    vi.stubGlobal('fetch', fetchMock);

    await reinstateDevice({
      device: 'DEV-001',
      effective_date: '2024-05-01',
      client_user: 'USR-003',
    });

    const { body } = lastRequest(fetchMock);
    expect(body.client_user).toBe('USR-003');
  });
});
