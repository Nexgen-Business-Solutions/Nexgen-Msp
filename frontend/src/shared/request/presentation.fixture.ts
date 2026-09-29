import type {
  RequestPresentation,
  RequestSubjectPresentation,
  RequestTargetPresentation,
} from '@/lib/api/requestPresentation';

const people: [string, string, number][] = [
  ['Alice Ndom', 'user:CU-1', 2],
  ['Brice Mvondo', 'user:CU-2', 3],
  ['Marie Dupont', 'new:marie', 4],
  ['Carine Ekotto', 'user:CU-4', 2],
  ['Daniel Fotso', 'user:CU-5', 2],
  ['Estelle Nkoa', 'user:CU-6', 2],
  ['Franck Mbassi', 'user:CU-7', 3],
  ['Grace Etoa', 'user:CU-8', 1],
  ['Irène Biloa', 'user:CU-9', 1],
];

const subjects: RequestSubjectPresentation[] = people.map(([full_name, subject_key, related]) => ({
  subject_key,
  full_name,
  department: 'Purchasing',
  type: subject_key.startsWith('new:') ? 'new' : 'existing',
  client_user: subject_key.startsWith('user:') ? subject_key.slice(5) : null,
  requested_client_user: subject_key.startsWith('new:') ? 'RCU-2026-00001' : null,
  related_work_count: related,
}));

const target = (overrides: Partial<RequestTargetPresentation>): RequestTargetPresentation => ({
  line_idx: 1,
  subject_key: 'user:CU-1',
  person_label: 'Alice Ndom',
  person_is_new: false,
  target_label: 'Microsoft 365 · Personal',
  target_kind: 'client_user',
  target_badge: null,
  operation_label: 'Add Microsoft 365',
  state_at_request: 'Not assigned',
  state_changed: false,
  relationship: null,
  line_status: 'Pending',
  rejection_reason: null,
  ...overrides,
});

const m365Owners = ['Alice Ndom', 'Brice Mvondo', 'Carine Ekotto', 'Daniel Fotso', 'Estelle Nkoa', 'Franck Mbassi', 'Grace Etoa'];
const nextcloudOwners = ['Alice Ndom', 'Brice Mvondo', 'Carine Ekotto', 'Daniel Fotso', 'Estelle Nkoa', 'Franck Mbassi'];
const keyOf = (name: string) => people.find(([label]) => label === name)?.[1] ?? null;

export const presentationFixture = (): RequestPresentation => ({
  request: {
    name: 'SR-2026-00544',
    status: 'Under Review',
    customer: 'ACI',
    customer_name: 'Assurances Cameroun International',
    requester: 'devteam@aci.cm',
    requester_name: 'Devteam Cam',
    requested_date: '2026-09-29',
    priority: 'Medium',
    source: 'Portal',
    submitted_at: '2026-09-27 08:42:00',
    details: 'Please complete the Purchasing team changes before Monday morning.',
    details_by: 'Devteam Cam',
    details_at: '2026-09-27 08:42:00',
    badges: [
      { tone: 'blue', label: 'UNDER REVIEW' },
      { tone: 'slate', label: 'MEDIUM' },
      { tone: 'amber', label: '2 NEW ENTITIES' },
    ],
    customer_approval: {
      state: 'approved',
      by_name: 'Paul Approver',
      at: '2026-09-27 10:00:00',
      label: 'Approved · Paul Approver · 27 Sep 2026',
    },
    nexgen_status_label: 'Under Review',
    rejection: null,
    completed_at: null,
    modified: null,
  },
  summary: { people: 9, requested_actions: 4, concrete_targets: 16, new_entities: 2 },
  subjects,
  action_groups: [
    {
      group_key: 'grp-m365',
      operation_code: 'service.add',
      operation_label: 'Add Microsoft 365',
      domain: 'Service',
      context_label: 'Purchasing · Personal service',
      impact_label: '8 targets from 9 people',
      impact_detail: '1 left unchanged',
      target_count: 8,
      unchanged_count: 1,
      badges: [{ tone: 'amber', label: '1 NEW PERSON' }],
      relationship: null,
      targets: [
        ...m365Owners.map((name, index) =>
          target({ line_idx: index + 1, subject_key: keyOf(name), person_label: name })
        ),
        target({
          line_idx: 8,
          subject_key: 'new:marie',
          person_label: 'Marie Dupont',
          person_is_new: true,
          target_kind: 'requested_client_user',
          state_at_request: null,
        }),
      ],
      unchanged: [{ subject_key: 'user:CU-9', person_label: 'Irène Biloa', reason: 'Already has Microsoft 365' }],
    },
    {
      group_key: 'grp-nextcloud',
      operation_code: 'service.end',
      operation_label: 'End Nextcloud',
      domain: 'Service',
      context_label: 'Purchasing · Personal service',
      impact_label: '6 targets from 9 people',
      impact_detail: '3 left unchanged',
      target_count: 6,
      unchanged_count: 3,
      badges: [{ tone: 'slate', label: 'CURRENT ASSIGNMENTS' }],
      relationship: null,
      targets: nextcloudOwners.map((name, index) =>
        target({
          line_idx: index + 9,
          subject_key: keyOf(name),
          person_label: name,
          target_label: 'Nextcloud',
          operation_label: 'End Nextcloud',
          state_at_request: 'Active',
          state_changed: name === 'Brice Mvondo',
        })
      ),
      unchanged: [
        { subject_key: 'new:marie', person_label: 'Marie Dupont', reason: 'Does not hold Nextcloud' },
        { subject_key: 'user:CU-8', person_label: 'Grace Etoa', reason: 'Does not hold Nextcloud' },
        { subject_key: 'user:CU-9', person_label: 'Irène Biloa', reason: 'Does not hold Nextcloud' },
      ],
    },
    {
      group_key: 'grp-holder',
      operation_code: 'device.change_holder',
      operation_label: 'Change holder',
      domain: 'Device',
      context_label: 'ACI-LT-023 · Device operation',
      impact_label: '1 Device',
      impact_detail: 'Existing Device',
      target_count: 1,
      unchanged_count: 0,
      badges: [],
      relationship: {
        from_label: 'Franck Mbassi',
        to_label: 'Marie Dupont',
        to_is_new: true,
        note: null,
      },
      targets: [
        target({
          line_idx: 15,
          subject_key: 'user:CU-7',
          person_label: 'Franck Mbassi',
          target_label: 'ACI-LT-023',
          target_kind: 'managed_device',
          operation_label: 'Change holder',
          state_at_request: 'Held by Franck Mbassi',
          relationship: {
            from_label: 'Franck Mbassi',
            to_label: 'Marie Dupont',
            to_is_new: true,
            note: null,
          },
        }),
      ],
      unchanged: [],
    },
    {
      group_key: 'grp-sophos',
      operation_code: 'service.add',
      operation_label: 'Add Sophos',
      domain: 'Service',
      context_label: 'Device service',
      impact_label: '1 requested Device',
      impact_detail: null,
      target_count: 1,
      unchanged_count: 0,
      badges: [],
      relationship: null,
      targets: [
        target({
          line_idx: 16,
          subject_key: 'new:marie',
          person_label: 'Marie Dupont',
          person_is_new: true,
          target_label: 'New laptop',
          target_kind: 'requested_device',
          target_badge: 'UNRESOLVED',
          operation_label: 'Add Sophos',
          state_at_request: null,
        }),
      ],
      unchanged: [],
    },
  ],
  requested_entities: [
    {
      kind: 'client_user',
      name: 'RCU-2026-00001',
      key: 'new:marie',
      display_name: 'Marie Dupont',
      context_label: 'Requested Client User · Purchasing',
      status: 'Open',
      readiness: 'needs_review',
      badge: 'NEEDS REVIEW',
      resolved_to: null,
      requested_snapshot: { full_name: 'Marie Dupont', department: 'Purchasing', email: 'marie@aci.cm', username: 'm.dupont' },
      prepared_values: {},
      requested_work_count: 4,
      relationship_summary: ['Used by 4 requested actions · destination holder for ACI-LT-023'],
    },
    {
      kind: 'device',
      name: 'RDEV-2026-00001',
      key: 'new-device:laptop',
      display_name: 'New laptop',
      context_label: 'Requested Device · intended for Marie Dupont',
      status: 'Open',
      readiness: 'needs_information',
      badge: 'UNRESOLVED',
      resolved_to: null,
      requested_snapshot: { display_label: 'New laptop', device_type: 'Laptop' },
      prepared_values: {},
      requested_work_count: 1,
      relationship_summary: ['Requested work: Add Sophos · holder: Marie Dupont [NEW]'],
    },
  ],
  attention: [],
  fulfilment_outcome: null,
});

export const completedFixture = (): RequestPresentation => {
  const base = presentationFixture();
  return {
    ...base,
    request: {
      ...base.request,
      status: 'Completed',
      completed_at: '2026-09-28 16:00:00',
      badges: [
        { tone: 'emerald', label: 'COMPLETED' },
        { tone: 'slate', label: 'MEDIUM' },
      ],
      nexgen_status_label: 'Completed · 28 Sep 2026',
    },
    action_groups: base.action_groups.map((group) => ({
      ...group,
      targets: group.targets.map((row) => ({ ...row, line_status: 'Approved' as const })),
    })),
    attention: [],
    fulfilment_outcome: {
      entities: [
        {
          kind: 'client_user',
          display_name: 'Marie Dupont',
          context_label: 'Requested Client User',
          badge: 'RESOLVED',
          resolved_label: 'CU-1054',
          resolved_note: 'Created during fulfilment',
          link: { doctype: 'MSP Client User', name: 'CU-1054' },
        },
        {
          kind: 'device',
          display_name: 'New laptop',
          context_label: 'Requested Device for Marie Dupont',
          badge: 'RESOLVED',
          resolved_label: 'ACI-LT-087',
          resolved_note: 'Existing Device selected',
          link: { doctype: 'MSP Managed Device', name: 'ACI-LT-087' },
        },
      ],
      work: { completed: 16, unresolved: 0, badge: 'COMPLETED' },
    },
  };
};
