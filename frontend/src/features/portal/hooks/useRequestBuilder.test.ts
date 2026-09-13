import { describe, expect, it } from 'vitest';
import type { PortalRequestDetail } from '@/lib/api/portal';
import { fromSavedRequest } from './useRequestBuilder';

const saved = (lines: Record<string, unknown>[]) =>
  ({ priority: 'Medium', lines }) as unknown as PortalRequestDetail;

const line = (email: string, service: string) => ({
  is_new_user: 1,
  new_user_full_name: 'Alex Martin',
  new_user_department: 'Operations',
  new_user_email: email,
  new_user_username: email,
  action: 'Add',
  action_label: 'Add',
  request_action: 'Grant service',
  requested_service: service,
  service_name: service,
  managed_device: null,
});

describe('rebuilding a saved request', () => {
  it('keeps different new people separate even when their names match', () => {
    const rebuilt = fromSavedRequest(
      saved([line('alex.one@example.com', 'M365'), line('alex.two@example.com', 'VPN')])
    );

    expect(rebuilt.subjects).toHaveLength(2);
    expect(new Set(rebuilt.intents.map((intent) => intent.subjectKey)).size).toBe(2);
  });

  it('keeps otherwise identical future colleagues separate by their saved group', () => {
    const first = { ...line('', 'M365'), subject_key: 'new-user:request:person_one' };
    const second = { ...line('', 'VPN'), subject_key: 'new-user:request:person_two' };
    const rebuilt = fromSavedRequest(saved([first, second]));

    expect(rebuilt.subjects).toHaveLength(2);
    expect(new Set(rebuilt.intents.map((intent) => intent.subjectKey)).size).toBe(2);
  });

  it('keeps several changes for the same new person together', () => {
    const rebuilt = fromSavedRequest(
      saved([line('alex@example.com', 'M365'), line('alex@example.com', 'VPN')])
    );

    expect(rebuilt.subjects).toHaveLength(1);
    expect(new Set(rebuilt.intents.map((intent) => intent.subjectKey)).size).toBe(1);
  });
});
