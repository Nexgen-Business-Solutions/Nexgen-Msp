import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import type {
  PortalRequestDetail,
  RequestPayload,
  RequestTarget,
  RequestedDeviceDraft,
} from '@/lib/api/portal';
import { restoreSaved, useRequestBuilder } from './useRequestBuilder';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return { ...actual, saveRequestDraft: vi.fn(), createRequest: vi.fn(), getRequest: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const personTarget = (key: string, name: string, extra: Partial<RequestTarget> = {}): RequestTarget => ({
  subject_key: key,
  client_user: key.startsWith('user:') ? key.slice(5) : null,
  full_name: name,
  target_scope: 'User',
  managed_device: null,
  device_label: null,
  source_service_assignment: null,
  ...extra,
});

const savedGroup = (
  key: string,
  item: string,
  targets: RequestTarget[]
): PortalRequestDetail['action_groups'][number] => ({
  group_key: key,
  operation_code: 'service.add',
  operation_label_snapshot: `Add ${item}`,
  domain: 'Service',
  service_item: item,
  group_origin: 'Customer',
  source_scope_type: 'All',
  source_scope_key: null,
  source_scope_label: 'All selected',
  selected_subject_count: 2,
  applicable_target_count: targets.length,
  excluded_subject_count: 0,
  configuration: { comment: null, targets, exclusions: [] },
  impact: [],
});

const alex = (key: string, email: string): PortalRequestDetail['subjects'][number] => ({
  subject_key: key,
  kind: 'new',
  client_user: null,
  requested_client_user: `RCU-${key}`,
  full_name: 'Alex Martin',
  department: 'Operations',
  email,
  username: email,
  external_employee_id: null,
  start_date: null,
  added_via: 'New',
  selection_label: null,
});

const savedWith = (overrides: Partial<PortalRequestDetail>): PortalRequestDetail => ({
  name: 'SR-1',
  customer: 'ACI',
  request_type: 'Change',
  status: 'Draft',
  priority: 'Medium',
  details: null,
  source: 'Portal',
  creation: '2026-09-28',
  modified: '2026-09-28',
  rejection_reason: null,
  refused_by_customer: false,
  reviewed_on: null,
  can_decide: false,
  can_edit: false,
  has_approver: false,
  lines: [],
  requested_date: null,
  subjects: [],
  requested_devices: [],
  restorable: true,
  action_groups: [],
  ...overrides,
});

describe('rebuilding a saved request', () => {
  it('keeps different new people separate even when their names match', () => {
    const rebuilt = restoreSaved(
      savedWith({
        subjects: [alex('new:one', 'alex.one@example.com'), alex('new:two', 'alex.two@example.com')],
        action_groups: [
          savedGroup('grp:m365', 'M365', [personTarget('new:one', 'Alex Martin')]),
          savedGroup('grp:vpn', 'VPN', [personTarget('new:two', 'Alex Martin')]),
        ],
      })
    );

    expect(rebuilt.subjects).toHaveLength(2);
    expect(
      new Set(rebuilt.actionGroups.flatMap((group) => group.targets.map((row) => row.subject_key))).size
    ).toBe(2);
  });

  it('keeps otherwise identical future colleagues separate by their saved group', () => {
    const rebuilt = restoreSaved(
      savedWith({
        subjects: [alex('new:person_one', ''), alex('new:person_two', '')],
        action_groups: [
          savedGroup('grp:m365', 'M365', [personTarget('new:person_one', 'Alex Martin')]),
          savedGroup('grp:vpn', 'VPN', [personTarget('new:person_two', 'Alex Martin')]),
        ],
      })
    );

    expect(rebuilt.subjects).toHaveLength(2);
    expect(
      new Set(rebuilt.actionGroups.flatMap((group) => group.targets.map((row) => row.subject_key))).size
    ).toBe(2);
  });

  it('keeps several changes for the same new person together', () => {
    const rebuilt = restoreSaved(
      savedWith({
        subjects: [alex('new:one', 'alex@example.com')],
        action_groups: [
          savedGroup('grp:m365', 'M365', [personTarget('new:one', 'Alex Martin')]),
          savedGroup('grp:vpn', 'VPN', [personTarget('new:one', 'Alex Martin')]),
        ],
      })
    );

    expect(rebuilt.subjects).toHaveLength(1);
    expect(
      new Set(rebuilt.actionGroups.flatMap((group) => group.targets.map((row) => row.subject_key))).size
    ).toBe(1);
  });

  it('never rebuilds a draft from its atomic lines', () => {
    const rebuilt = restoreSaved(
      savedWith({
        subjects: [alex('new:one', '')],
        lines: [
          {
            idx: 1,
            action: 'Add',
            line_status: 'Pending',
            rejection_reason: null,
            operation_code: 'service.add',
            operation_label_snapshot: 'Add M365',
            operation_payload: null,
            state_snapshot: null,
            requested_holder: null,
            selection_origin: 'Company',
            selection_group_key: null,
            selection_label: 'All selected',
            target_scope: 'User',
            subject_key: 'new:one',
            device_requirement_key: null,
            client_user: null,
            managed_device: null,
            requested_client_user: 'RCU-new:one',
            requested_device: null,
            requested_for_requested_client_user: null,
            requested_holder_requested_client_user: null,
            source_service_assignment: null,
            requested_for_user: null,
            requested_service: 'M365',
            user_name: 'Alex Martin',
            department: 'Operations',
            username: null,
            service_name: 'Microsoft 365',
            action_label: 'Add M365',
            requested_holder_name: null,
            requested_device_label: null,
            hostname: null,
            serial_number: null,
            device_type: null,
            device_holder: null,
            requested_effective_date: null,
            comment: null,
            service_status: null,
            service_start_date: null,
            delivered_on: null,
            service_scope: 'User',
          },
        ],
        action_groups: [],
      })
    );

    expect(rebuilt.actionGroups).toEqual([]);
  });

  it('gives the builder exactly the draft fields of a saved requested device, never its record state', () => {
    const rebuilt = restoreSaved(
      savedWith({
        subjects: [alex('new:one', '')],
        requested_devices: [
          {
            ...laptop,
            intended_holder_subject_key: 'new:one',
            requested_device: 'RDEV-2026-00009',
            status: 'Open',
            intended_holder_requested_client_user: 'RCU-new:one',
          },
        ],
      })
    );

    expect(rebuilt.requestedDevices).toEqual([
      { ...laptop, intended_holder_subject_key: 'new:one', requested_device: 'RDEV-2026-00009' },
    ]);
  });

});

const laptop: RequestedDeviceDraft = {
  device_requirement_key: 'new-device:laptop',
  requested_device: null,
  display_label: 'New laptop',
  device_type: 'Laptop',
  hostname: null,
  serial_number: null,
  asset_tag: null,
  manufacturer: null,
  model: null,
  operating_system: null,
  intended_holder_client_user: null,
  intended_holder_subject_key: null,
};

const tidy = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_key, entry) => (entry === null ? undefined : entry)));

const RCU = 'RCU-2026-00001';
const RDEV = 'RDEV-2026-00001';

const serverSave = (payload: RequestPayload): PortalRequestDetail => {
  const rcu = (key?: string | null) =>
    key && payload.subjects.some((row) => row.subject_key === key && row.kind === 'new') ? RCU : null;

  return {
    name: 'SR-DRAFT',
    customer: 'ACI',
    request_type: 'Change',
    status: 'Draft',
    priority: payload.priority ?? 'Medium',
    details: payload.details ?? null,
    requested_date: payload.requested_date ?? null,
    source: 'Portal',
    creation: '2026-09-28',
    modified: '2026-09-28',
    rejection_reason: null,
    reviewed_on: null,
    can_decide: false,
    can_edit: false,
    has_approver: false,
    refused_by_customer: false,
    lines: [],
    restorable: true,
    subjects: payload.subjects.map((row) => ({
      subject_key: row.subject_key,
      kind: row.kind,
      client_user: row.client_user,
      requested_client_user: row.kind === 'new' ? RCU : null,
      full_name: row.full_name,
      department: row.department ?? null,
      email: row.email ?? null,
      username: row.username ?? null,
      external_employee_id: row.kind === 'new' ? (row.external_employee_id ?? null) : null,
      start_date: row.kind === 'new' ? (row.start_date ?? null) : null,
      added_via: row.added_via,
      selection_label: row.selection_label ?? null,
    })),
    requested_devices: payload.requested_devices.map((row) => ({
      device_requirement_key: row.device_requirement_key,
      requested_device: RDEV,
      status: 'Open' as const,
      display_label: row.display_label,
      device_type: row.device_type ?? null,
      hostname: row.hostname ?? null,
      serial_number: row.serial_number ?? null,
      asset_tag: row.asset_tag ?? null,
      manufacturer: row.manufacturer ?? null,
      model: row.model ?? null,
      operating_system: row.operating_system ?? null,
      intended_holder_client_user: row.intended_holder_client_user ?? null,
      intended_holder_requested_client_user: rcu(row.intended_holder_subject_key),
      intended_holder_subject_key: row.intended_holder_subject_key ?? null,
    })),
    action_groups: payload.action_groups.map((group) => ({
      group_key: group.group_key,
      operation_code: group.operation_code,
      operation_label_snapshot: group.operation_label_snapshot,
      domain: group.domain,
      service_item: group.service_item ?? null,
      group_origin: 'Customer',
      source_scope_type: group.source_scope_type,
      source_scope_key: group.source_scope_key ?? null,
      source_scope_label: group.source_scope_label,
      selected_subject_count: group.selected_subject_count,
      applicable_target_count: group.targets.length,
      excluded_subject_count: group.exclusions.length,
      configuration: {
        comment: null,
        targets: group.targets.map((target) => ({
          ...target,
          requested_client_user: rcu(target.subject_key),
          requested_device: target.device_requirement_key ? RDEV : null,
          requested_holder_requested_client_user: rcu(target.requested_holder_subject_key),
        })),
        exclusions: group.exclusions,
      },
      impact: [],
    })),
  };
};

const buildMarieRequest = (builder: ReturnType<typeof useRequestBuilder>) => {
  let marie = '';
  act(() => {
    marie = builder.addNewSubject({ fullName: 'Marie Dupont', department: 'Purchasing' });
    builder.addExistingSubject({ name: 'CU-7', full_name: 'Franck Mbassi', department: 'Purchasing' });
  });

  return marie;
};

describe('a draft saved, reopened and saved again', () => {
  it('keeps every key, every target and every choice, and sends the canonical names', async () => {
    vi.mocked(portal.saveRequestDraft).mockImplementation(async (payload) => serverSave(payload));

    const first = renderHook(() => useRequestBuilder(), { wrapper: makeWrapper() });
    const marie = buildMarieRequest(first.result.current);

    act(() => {
      first.result.current.addActionGroup(
        {
          operationCode: 'service.add',
          operationLabelSnapshot: 'Add Sophos',
          domain: 'Service',
          serviceItem: 'SOPHOS',
          sourceScopeType: 'Person',
          sourceScopeKey: marie,
          sourceScopeLabel: 'Marie Dupont',
          selectedSubjectCount: 1,
          targets: [
            personTarget(marie, 'Marie Dupont', {
              target_scope: 'Device',
              device_requirement_key: laptop.device_requirement_key,
              device_label: 'New laptop',
            }),
          ],
          exclusions: [],
        },
        [{ ...laptop, intended_holder_subject_key: marie }]
      );
    });
    act(() => {
      first.result.current.addActionGroup({
        operationCode: 'service.add',
        operationLabelSnapshot: 'Add Microsoft 365',
        domain: 'Service',
        serviceItem: 'M365',
        sourceScopeType: 'All',
        sourceScopeKey: null,
        sourceScopeLabel: 'All selected',
        selectedSubjectCount: 2,
        targets: [personTarget(marie, 'Marie Dupont')],
        exclusions: [],
      });
      first.result.current.addActionGroup({
        operationCode: 'device.transfer',
        operationLabelSnapshot: 'Change holder',
        domain: 'Device',
        serviceItem: null,
        sourceScopeType: 'Person',
        sourceScopeKey: 'user:CU-7',
        sourceScopeLabel: 'Franck Mbassi',
        selectedSubjectCount: 1,
        targets: [
          personTarget('user:CU-7', 'Franck Mbassi', {
            target_scope: 'Device',
            managed_device: 'MD-23',
            device_label: 'ACI-LT-023',
            requested_holder_subject_key: marie,
          }),
        ],
        exclusions: [],
      });
    });

    await act(async () => {
      await first.result.current.putAside();
    });

    const sent = vi.mocked(portal.saveRequestDraft).mock.calls[0][0];
    expect(sent.name).toBeUndefined();
    expect(sent).not.toHaveProperty('lines');
    expect(sent.requested_devices).toHaveLength(1);
    expect(sent.action_groups.map((group) => group.operation_code)).toEqual([
      'device.assign',
      'service.add',
      'service.add',
      'device.transfer',
    ]);
    expect(first.result.current.draft).toBe('SR-DRAFT');

    const stored = serverSave(sent);
    vi.mocked(portal.getRequest).mockResolvedValue(stored);

    const reopened = renderHook(() => useRequestBuilder(undefined, 'SR-DRAFT'), { wrapper: makeWrapper() });
    await waitFor(() => expect(reopened.result.current.reopening).toBe(false));
    expect(reopened.result.current.unrestorable).toBe(false);

    await act(async () => {
      await reopened.result.current.putAside();
    });
    await act(async () => {
      await first.result.current.putAside();
    });

    const again = vi.mocked(portal.saveRequestDraft).mock.calls[1][0];
    const fromFirst = vi.mocked(portal.saveRequestDraft).mock.calls[2][0];

    expect(again.name).toBe('SR-DRAFT');
    expect(fromFirst.name).toBe('SR-DRAFT');
    expect(tidy(fromFirst)).toEqual(tidy(again));
    expect(again).not.toHaveProperty('lines');

    expect(again.subjects.map((row) => row.subject_key)).toEqual(sent.subjects.map((row) => row.subject_key));
    expect(again.subjects.find((row) => row.subject_key === marie)?.requested_client_user).toBe(RCU);
    expect(again.requested_devices).toEqual([
      { ...laptop, intended_holder_subject_key: marie, requested_device: RDEV },
    ]);
    expect(again.action_groups.map((group) => group.group_key)).toEqual(
      sent.action_groups.map((group) => group.group_key)
    );
    expect(again.action_groups.map((group) => group.targets.map((row) => row.subject_key))).toEqual(
      sent.action_groups.map((group) => group.targets.map((row) => row.subject_key))
    );

    const m365 = again.action_groups.find((group) => group.service_item === 'M365');
    expect(m365?.targets, 'Franck was left unchecked and stays so').toHaveLength(1);
    expect(m365?.targets[0].requested_client_user).toBe(RCU);

    const sophos = again.action_groups.find((group) => group.service_item === 'SOPHOS');
    expect(sophos?.targets[0].device_requirement_key).toBe(laptop.device_requirement_key);
    expect(sophos?.targets[0].requested_device).toBe(RDEV);

    const transfer = again.action_groups.find((group) => group.operation_code === 'device.transfer');
    expect(transfer?.targets[0]).toMatchObject({
      managed_device: 'MD-23',
      requested_holder_subject_key: marie,
      requested_holder_requested_client_user: RCU,
    });
    expect(transfer?.targets[0].requested_holder ?? null).toBeNull();

    expect(new Set(again.requested_devices.map((row) => row.device_requirement_key)).size).toBe(1);
    expect(again.subjects.filter((row) => row.kind === 'new')).toHaveLength(1);
  });

  it('refuses to save a draft the server says it cannot restore, although it looks complete', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue(
      savedWith({
        name: 'SR-OLD',
        restorable: false,
        subjects: [alex('new:one', '')],
        action_groups: [savedGroup('grp:m365', 'M365', [personTarget('new:one', 'Alex Martin')])],
      })
    );

    const { result } = renderHook(() => useRequestBuilder(undefined, 'SR-OLD'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.reopening).toBe(false));

    expect(result.current.unrestorable).toBe(true);
    expect(result.current.canSave).toBe(false);
    expect(result.current.canSend).toBe(false);

    await act(async () => {
      expect(await result.current.putAside()).toBeNull();
    });
    expect(portal.saveRequestDraft).not.toHaveBeenCalled();
    expect(result.current.subjects, 'nothing is restored from a draft the server refuses').toEqual([]);
    expect(result.current.actionGroups).toEqual([]);
  });

  it('reopens a draft the server says it can restore, even one a client guess would have refused', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue(
      savedWith({
        name: 'SR-KEPT',
        restorable: true,
        subjects: [alex('new:one', '')],
        action_groups: [
          savedGroup('grp:sophos', 'SOPHOS', [
            personTarget('new:one', 'Alex Martin', { device_requirement_key: 'new-device:minted-by-the-server' }),
          ]),
        ],
      })
    );

    const { result } = renderHook(() => useRequestBuilder(undefined, 'SR-KEPT'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.reopening).toBe(false));

    expect(result.current.unrestorable).toBe(false);
    expect(result.current.canSave).toBe(true);
    expect(result.current.subjects.map((subject) => subject.key)).toEqual(['new:one']);
    expect(result.current.actionGroups[0].targets[0].device_requirement_key).toBe(
      'new-device:minted-by-the-server'
    );
  });
});

describe('one requested device, many acts', () => {
  it('is one entry in requested_devices, referenced by the assign act and by both services', async () => {
    vi.mocked(portal.createRequest).mockResolvedValue({ name: 'SR-2' } as never);
    const { result } = renderHook(() => useRequestBuilder(), { wrapper: makeWrapper() });
    const marie = buildMarieRequest(result.current);
    const device = { ...laptop, intended_holder_subject_key: marie };
    const onLaptop = (item: string) => ({
      operationCode: 'service.add',
      operationLabelSnapshot: `Add ${item}`,
      domain: 'Service' as const,
      serviceItem: item,
      sourceScopeType: 'Person' as const,
      sourceScopeKey: marie,
      sourceScopeLabel: 'Marie Dupont',
      selectedSubjectCount: 1,
      targets: [
        personTarget(marie, 'Marie Dupont', {
          target_scope: 'Device',
          device_requirement_key: device.device_requirement_key,
          device_label: 'New laptop',
        }),
      ],
      exclusions: [],
    });

    act(() => {
      result.current.addActionGroup(onLaptop('SOPHOS'), [device]);
    });
    act(() => {
      result.current.addActionGroup(onLaptop('BACKUP'), [device]);
    });

    expect(result.current.actionGroups.map((group) => group.operationLabelSnapshot)).toEqual([
      'Assign Device',
      'Add SOPHOS',
      'Add BACKUP',
    ]);

    await act(async () => {
      await result.current.send();
    });

    const payload = vi.mocked(portal.createRequest).mock.calls[0][0];
    const targets = payload.action_groups.flatMap((group) => group.targets);

    expect(payload).not.toHaveProperty('lines');
    expect(payload.requested_devices).toHaveLength(1);
    expect(targets).toHaveLength(3);
    expect(new Set(targets.map((row) => row.device_requirement_key))).toEqual(
      new Set([device.device_requirement_key])
    );
    expect(payload.action_groups[0]).toMatchObject({
      operation_code: 'device.assign',
      targets: [{ subject_key: marie, requested_holder_subject_key: marie }],
    });
  });

  it('drops the machine with the last act that uses it', () => {
    const { result } = renderHook(() => useRequestBuilder(), { wrapper: makeWrapper() });
    const marie = buildMarieRequest(result.current);

    act(() => {
      result.current.addActionGroup(null, [{ ...laptop, intended_holder_subject_key: marie }]);
    });
    expect(result.current.deviceDrafts).toHaveLength(1);

    act(() => {
      result.current.removeActionGroup(result.current.actionGroups[0].groupKey);
    });
    expect(result.current.deviceDrafts).toHaveLength(0);
    expect(result.current.payload.requested_devices).toHaveLength(0);
  });
});

describe('people changed after an act was added', () => {
  it('needs review, and blocks sending until the impact is confirmed again', () => {
    const { result } = renderHook(() => useRequestBuilder(), { wrapper: makeWrapper() });
    act(() => {
      result.current.addExistingSubject({ name: 'CU-1', full_name: 'Alice Ndom' });
    });
    act(() => {
      result.current.addActionGroup({
        operationCode: 'service.add',
        operationLabelSnapshot: 'Add VPN',
        domain: 'Service',
        serviceItem: 'VPN',
        sourceScopeType: 'All',
        sourceScopeKey: null,
        sourceScopeLabel: 'All selected',
        selectedSubjectCount: 1,
        targets: [personTarget('user:CU-1', 'Alice Ndom')],
        exclusions: [],
      });
    });
    expect(result.current.canSend).toBe(true);

    act(() => {
      result.current.addExistingSubject({ name: 'CU-2', full_name: 'Brice Mvondo' });
    });
    const group = result.current.actionGroups[0];
    expect(result.current.needsReview(group)).toBe(true);
    expect(result.current.reviewNeeded).toBe(true);
    expect(result.current.canSend).toBe(false);
    expect(group.targets, 'nobody is added silently').toHaveLength(1);

    act(() => {
      result.current.reviewActionGroup(group.groupKey, group.targets, group.exclusions);
    });
    expect(result.current.reviewNeeded).toBe(false);
    expect(result.current.canSend).toBe(true);

    act(() => {
      result.current.removeSubject('user:CU-2');
    });
    expect(result.current.reviewNeeded, 'removing a person updates the count').toBe(false);
    expect(result.current.actionGroups[0].selectedSubjectCount).toBe(1);
  });
});
