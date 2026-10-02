import { useEffect, useMemo, useState } from 'react';
import type {
  PortalRequestDetail,
  RequestActionGroupDraft,
  RequestedDeviceDraft,
  RequestExclusion,
  RequestPayload,
  RequestSubjectDraft,
  RequestTarget,
} from '@/lib/api/portal';
import {
  useCreateServiceRequest,
  useDiscardRequestDraft,
  useRequestSubjectContext,
  useSaveRequestDraft,
  useServiceRequest,
  useUpdateServiceRequest,
} from './usePortal';

/**
 * An act on a machine, started from that machine's own page.
 *
 * The page it comes from mutates nothing: it hands the builder the operation, the machine and
 * the people it concerns, and the customer can add more to the request before sending it.
 */
export type RequestSeed = {
  operationCode: string;
  actionLabel: string;
  managedDevice: string;
  deviceLabel: string;
  subject: { clientUser: string; fullName: string; department?: string | null };
  requestedHolder?: string;
  requestedHolderLabel?: string;
  currentHolder?: string;
  currentHolderLabel?: string;
  requestedEffectiveDate?: string;
  comment?: string;
};

/** How a person came to be in this request: picked by hand, or through a group. */
export type SelectionOrigin = 'Individual' | 'Department' | 'Company';

/**
 * One act the customer added in the Actions workspace, kept exactly as they built it.
 *
 * A group is the customer's own unit of intent: the scope it was chosen from, the targets
 * it actually reaches, and the subjects it leaves untouched with the reason why. The atomic
 * lines are derived from it by the server, never the other way round.
 */
export type RequestActionGroup = {
  groupKey: string;
  operationCode: string;
  operationLabelSnapshot: string;
  domain: 'Service' | 'Device' | 'People';
  serviceItem?: string | null;
  sourceScopeType: 'All' | 'Department' | 'Person';
  sourceScopeKey?: string | null;
  sourceScopeLabel: string;
  selectedSubjectCount: number;
  targets: RequestTarget[];
  exclusions: RequestExclusion[];
};

/** The person a group of intentions is about, whether or not they exist yet. */
export type RequestSubject = {
  key: string;
  kind: 'existing' | 'new' | 'device';
  clientUser?: string;
  requestedClientUser?: string;
  /** a machine asked about in its own right, because nobody holds it */
  managedDevice?: string;
  requestedDevice?: string;
  deviceRequirementKey?: string;
  fullName?: string;
  department?: string;
  email?: string;
  /** the snapshot this person came from, kept on every line they end up on */
  selectionOrigin?: SelectionOrigin;
  selectionGroupKey?: string;
  selectionLabel?: string;
  selectionSnapshotAt?: string;
  username?: string;
  externalEmployeeId?: string;
  startDate?: string;
};

export type HolderPerson = {
  name: string;
  full_name: string;
  department?: string | null;
  email?: string | null;
};

export type NewPersonValues = {
  fullName: string;
  department?: string;
  email?: string;
  username?: string;
  externalEmployeeId?: string;
  startDate?: string;
};

export const UNRESTORABLE_DRAFT =
  'This draft contains request data that could not be restored safely. Do not resave it. Contact Nexgen support.';

export const REQUEST_LOCKED =
  'This request can no longer be modified: work on it has started.';

export const REVIEW_NEEDED =
  'Some requested actions need review because the people in their scope changed.';

const newKey = () => Math.random().toString(36).slice(2, 10);

/**
 * The key one subject keeps for the life of the request.
 *
 * An existing person is keyed on the record they already are, so the same person reached
 * twice — by hand and through their Department — is one subject wherever it is read. Somebody
 * who does not exist yet gets a draft key, never one derived from the name they were typed as.
 */
export const subjectKeyOf = (clientUser?: string) =>
  clientUser ? `user:${clientUser}` : `new:${newKey()}`;

export const deviceKeyOf = () => `new-device:${newKey()}`;

export const deviceLabelOf = (values: Partial<RequestedDeviceDraft>) =>
  values.hostname?.trim() ||
  (values.device_type ? `New ${values.device_type.toLowerCase()}` : 'New device');

const addedVia = (subject: RequestSubject): RequestSubjectDraft['added_via'] =>
  subject.kind === 'device'
    ? 'Device'
    : subject.kind === 'new'
    ? 'New'
    : subject.selectionOrigin === 'Department'
      ? 'Department'
      : subject.selectionOrigin === 'Company'
        ? 'Company'
        : 'Existing';

const originOf = (addedVia?: string | null): SelectionOrigin =>
  addedVia === 'Department' ? 'Department' : addedVia === 'Company' ? 'Company' : 'Individual';

type Restored = {
  subjects: RequestSubject[];
  requestedDevices: RequestedDeviceDraft[];
  actionGroups: RequestActionGroup[];
  priority: string;
  details: string;
  requestedDate: string;
};

export const restoreSaved = (saved: PortalRequestDetail, keepNames = true): Restored => {
  const strip = (target: RequestTarget): RequestTarget =>
    keepNames
      ? target
      : {
          ...target,
          requested_client_user: null,
          requested_device: null,
          requested_holder_requested_client_user: null,
        };

  return {
    subjects: saved.subjects.map((row) => ({
      key: row.subject_key,
      kind: row.kind,
      clientUser: row.client_user ?? undefined,
      requestedClientUser: keepNames ? (row.requested_client_user ?? undefined) : undefined,
      managedDevice: row.managed_device ?? undefined,
      requestedDevice: keepNames ? (row.requested_device ?? undefined) : undefined,
      deviceRequirementKey: row.device_requirement_key ?? undefined,
      fullName: row.full_name,
      department: row.department ?? undefined,
      email: row.email ?? undefined,
      username: row.username ?? undefined,
      externalEmployeeId: row.external_employee_id ?? undefined,
      startDate: row.start_date ?? undefined,
      selectionOrigin: originOf(row.added_via),
      selectionLabel: row.selection_label ?? undefined,
    })),
    requestedDevices: saved.requested_devices.map((row) => ({
      device_requirement_key: row.device_requirement_key,
      requested_device: keepNames ? row.requested_device : null,
      display_label: row.display_label,
      device_type: row.device_type ?? null,
      hostname: row.hostname ?? null,
      serial_number: row.serial_number ?? null,
      asset_tag: row.asset_tag ?? null,
      manufacturer: row.manufacturer ?? null,
      model: row.model ?? null,
      operating_system: row.operating_system ?? null,
      intended_holder_client_user: row.intended_holder_client_user ?? null,
      intended_holder_subject_key: row.intended_holder_subject_key ?? null,
    })),
    actionGroups: saved.action_groups.map((group) => ({
      groupKey: group.group_key,
      operationCode: group.operation_code,
      operationLabelSnapshot: group.operation_label_snapshot,
      domain: (group.domain || 'Service') as RequestActionGroup['domain'],
      serviceItem: group.service_item,
      sourceScopeType: (group.source_scope_type || 'All') as RequestActionGroup['sourceScopeType'],
      sourceScopeKey: group.source_scope_key,
      sourceScopeLabel: group.source_scope_label ?? '',
      selectedSubjectCount: group.selected_subject_count,
      targets: (group.configuration.targets ?? []).map(strip),
      exclusions: group.configuration.exclusions ?? [],
    })),
    priority: saved.priority,
    details: saved.details ?? '',
    requestedDate: saved.requested_date ?? '',
  };
};

const canonicalNames = (saved: PortalRequestDetail) => ({
  people: new Map(
    saved.subjects
      .filter((row) => row.requested_client_user)
      .map((row) => [row.subject_key, row.requested_client_user as string])
  ),
  machines: new Map(
    saved.requested_devices.map((row) => [row.device_requirement_key, row.requested_device])
  ),
});

const namedTarget = (
  target: RequestTarget,
  { people, machines }: ReturnType<typeof canonicalNames>
): RequestTarget => {
  const next = { ...target };

  if (people.has(target.subject_key)) {
    next.requested_client_user = people.get(target.subject_key);
  }
  if (target.device_requirement_key && machines.has(target.device_requirement_key)) {
    next.requested_device = machines.get(target.device_requirement_key);
  }
  if (target.requested_holder_subject_key && people.has(target.requested_holder_subject_key)) {
    next.requested_holder_requested_client_user = people.get(target.requested_holder_subject_key);
  }

  return next;
};

const referencedDevices = (groups: RequestActionGroup[], subjects: RequestSubject[] = []) =>
  new Set([
    ...(groups.flatMap((group) =>
      group.targets.map((target) => target.device_requirement_key).filter(Boolean)
    ) as string[]),
    // a machine described in the People step is wanted for itself, before any act names it
    ...(subjects.map((subject) => subject.deviceRequirementKey).filter(Boolean) as string[]),
  ]);

export const useRequestBuilder = (
  onCreated?: (created: { name: string }) => void,
  reopen?: string,
  correct?: string,
  /** the person a page sent us here about, so nobody searches for who they were just reading */
  about?: string,
  /** an act on a machine, brought here from that machine's page */
  seed?: RequestSeed | null,
  edit?: string
) => {
  const [subjects, setSubjects] = useState<RequestSubject[]>([]);
  const [requestedDevices, setRequestedDevices] = useState<RequestedDeviceDraft[]>([]);
  const [actionGroups, setActionGroups] = useState<RequestActionGroup[]>([]);
  const [priority, setPriority] = useState('Medium');
  const [details, setDetails] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [draft, setDraft] = useState<string | null>(reopen ?? null);
  const [loaded, setLoaded] = useState(false);
  const [unrestorable, setUnrestorable] = useState(false);

  const create = useCreateServiceRequest();
  const saveDraft = useSaveRequestDraft();
  const discardDraft = useDiscardRequestDraft();
  const update = useUpdateServiceRequest();

  // a draft picked up again, or a refused request being corrected: the same document in
  // the first case, a fresh one in the second
  const source = reopen ?? correct ?? edit;
  const saved = useServiceRequest(source);
  const locked = saved.data
    ? reopen
      ? saved.data.status !== 'Draft'
      : correct
        ? saved.data.status !== 'Rejected'
        : !saved.data.can_edit
    : false;

  // arriving from somebody's page: they are the subject, picked for us
  const seeded = useRequestSubjectContext(source || !about ? undefined : about);

  useEffect(() => {
    if (source || loaded || !seeded.data) return;

    const person = seeded.data.user;
    setSubjects([
      {
        key: subjectKeyOf(person.name),
        kind: 'existing',
        clientUser: person.name,
        fullName: person.full_name,
        department: person.department ?? undefined,
        email: person.email ?? undefined,
      },
    ]);
    setLoaded(true);
  }, [source, loaded, seeded.data]);

  useEffect(() => {
    if (source || loaded || !seed) return;

    const key = subjectKeyOf(seed.subject.clientUser);
    setSubjects([
      {
        key,
        kind: 'existing',
        clientUser: seed.subject.clientUser,
        fullName: seed.subject.fullName,
        department: seed.subject.department ?? undefined,
      },
    ]);
    setActionGroups([
      {
        groupKey: `grp:${newKey()}`,
        operationCode: seed.operationCode,
        operationLabelSnapshot: seed.actionLabel,
        domain: 'Device',
        serviceItem: null,
        sourceScopeType: 'Person',
        sourceScopeKey: key,
        sourceScopeLabel: seed.subject.fullName,
        selectedSubjectCount: 1,
        targets: [
          {
            subject_key: key,
            client_user: seed.subject.clientUser,
            full_name: seed.subject.fullName,
            department: seed.subject.department ?? null,
            target_scope: 'Device',
            managed_device: seed.managedDevice,
            device_label: seed.deviceLabel,
            source_service_assignment: null,
            current_holder: seed.currentHolder ?? null,
            current_holder_label: seed.currentHolderLabel ?? null,
            requested_holder: seed.requestedHolder ?? null,
          },
        ],
        exclusions: [],
      },
    ]);
    if (seed.requestedEffectiveDate) setRequestedDate(seed.requestedEffectiveDate);
    if (seed.comment) setDetails(seed.comment);
    setLoaded(true);
  }, [source, loaded, seed]);

  useEffect(() => {
    if (!source || loaded || !saved.data) return;

    if (locked) {
      setLoaded(true);

      return;
    }

    if (!saved.data.restorable) {
      setUnrestorable(true);
      setLoaded(true);

      return;
    }

    const restored = restoreSaved(saved.data, !correct);

    setSubjects(restored.subjects);
    setRequestedDevices(restored.requestedDevices);
    setActionGroups(restored.actionGroups);
    if (restored.priority) setPriority(restored.priority);
    setDetails(restored.details);
    setRequestedDate(restored.requestedDate);
    setLoaded(true);
  }, [source, correct, locked, loaded, saved.data]);

  // ------------------------------------------------------------------ subjects
  const addExistingSubject = (
    person: {
      name: string;
      full_name: string;
      department?: string | null;
      email?: string | null;
    },
    from?: {
      selectionOrigin: SelectionOrigin;
      selectionGroupKey?: string;
      selectionLabel?: string;
      selectionSnapshotAt?: string;
    }
  ) => {
    const already = subjects.find((subject) => subject.clientUser === person.name);

    if (already) return already.key;

    const key = subjectKeyOf(person.name);
    setSubjects((current) =>
      current.some((subject) => subject.clientUser === person.name)
        ? current
        : [
            ...current,
            {
              key,
              kind: 'existing',
              clientUser: person.name,
              fullName: person.full_name,
              department: person.department ?? undefined,
              email: person.email ?? undefined,
              selectionOrigin: from?.selectionOrigin ?? 'Individual',
              selectionGroupKey: from?.selectionGroupKey,
              selectionLabel: from?.selectionLabel,
              selectionSnapshotAt: from?.selectionSnapshotAt,
            },
          ]
    );

    return key;
  };

  /**
   * Everyone a group selection resolved to, added at once.
   *
   * The snapshot is what was resolved: somebody already picked by hand stays as they were, and
   * the count of what was already there is reported so the screen can say it plainly.
   */
  const addGroupSubjects = (
    people: { name: string; full_name: string; department?: string | null; email?: string | null }[],
    from: {
      selectionOrigin: SelectionOrigin;
      selectionGroupKey?: string;
      selectionLabel?: string;
      selectionSnapshotAt?: string;
    }
  ) => {
    const known = new Set(subjects.map((subject) => subject.clientUser));
    const fresh = people.filter((person) => !known.has(person.name));

    setSubjects((current) => [
      ...current,
      ...fresh.map((person) => ({
        key: subjectKeyOf(person.name),
        kind: 'existing' as const,
        clientUser: person.name,
        fullName: person.full_name,
        department: person.department ?? undefined,
        email: person.email ?? undefined,
        selectionOrigin: from.selectionOrigin,
        selectionGroupKey: from.selectionGroupKey,
        selectionLabel: from.selectionLabel,
        selectionSnapshotAt: from.selectionSnapshotAt,
      })),
    ]);

    return { added: fresh.length, duplicates: people.length - fresh.length };
  };

  const addNewSubject = (values?: NewPersonValues) => {
    const key = subjectKeyOf();
    const clean = (value?: string) => value?.trim() || undefined;

    setSubjects((current) => [
      ...current,
      {
        key,
        kind: 'new',
        fullName: clean(values?.fullName),
        department: clean(values?.department),
        email: clean(values?.email),
        username: clean(values?.username),
        externalEmployeeId: clean(values?.externalEmployeeId),
        startDate: clean(values?.startDate),
      },
    ]);

    return key;
  };

  /**
   * A machine the request is about, because nobody holds it.
   *
   * A machine somebody holds is not a subject of its own: the request is about that person,
   * and the machine is one of the things they have. The caller sorts that out and sends the
   * holder here instead, so this only ever receives a free machine.
   */
  const addDeviceSubject = (
    device: {
      name?: string | null;
      label: string;
      deviceRequirementKey?: string | null;
    },
    described?: RequestedDeviceDraft
  ) => {
    const existing = subjects.find((subject) =>
      device.name
        ? subject.managedDevice === device.name
        : subject.deviceRequirementKey === device.deviceRequirementKey
    );

    if (existing) return existing.key;

    const key = device.name ? `device:${device.name}` : `device:${device.deviceRequirementKey}`;

    if (described) {
      setRequestedDevices((current) =>
        current.some((row) => row.device_requirement_key === described.device_requirement_key)
          ? current
          : [...current, described]
      );
    }

    setSubjects((current) =>
      current.some((subject) => subject.key === key)
        ? current
        : [
            ...current,
            {
              key,
              kind: 'device',
              managedDevice: device.name ?? undefined,
              deviceRequirementKey: device.deviceRequirementKey ?? undefined,
              fullName: device.label,
            },
          ]
    );

    return key;
  };

  const scopeCount = (group: Pick<RequestActionGroup, 'sourceScopeType' | 'sourceScopeKey'>) =>
    group.sourceScopeType === 'All'
      ? subjects.length
      : group.sourceScopeType === 'Department'
        ? subjects.filter((subject) => subject.department === group.sourceScopeKey).length
        : 1;

  const dropSubjects = (keys: Set<string>) => {
    const leaving = subjects.filter((subject) => keys.has(subject.key));
    const groups = actionGroups
      .map((group) => {
        const inScope = leaving.filter((subject) =>
          group.sourceScopeType === 'All'
            ? true
            : group.sourceScopeType === 'Department'
              ? subject.department === group.sourceScopeKey
              : subject.key === group.sourceScopeKey
        ).length;

        return {
          ...group,
          selectedSubjectCount: Math.max(0, group.selectedSubjectCount - inScope),
          targets: group.targets.filter(
            (target) =>
              !keys.has(target.subject_key) && !keys.has(target.requested_holder_subject_key ?? '')
          ),
          exclusions: group.exclusions.filter((row) => !keys.has(row.subject_key)),
        };
      })
      .filter((group) => group.targets.length > 0);
    const kept = subjects.filter((subject) => !keys.has(subject.key));
    const used = referencedDevices(groups, kept);

    setSubjects(kept);
    setActionGroups(groups);
    setRequestedDevices((current) =>
      current
        .filter((device) => used.has(device.device_requirement_key))
        .map((device) =>
          keys.has(device.intended_holder_subject_key ?? '')
            ? { ...device, intended_holder_subject_key: null }
            : device
        )
    );
  };

  /** Take the people a refusal named out of the request, and everything asked for them. */
  const removeSubjectsFor = (clientUsers: string[]) => {
    const unwanted = new Set(clientUsers);

    dropSubjects(
      new Set(
        subjects.filter((subject) => unwanted.has(subject.clientUser ?? '')).map((s) => s.key)
      )
    );
  };

  const removeSubject = (key: string) => dropSubjects(new Set([key]));

  const assignGroupsFor = (
    devices: RequestedDeviceDraft[],
    covered: RequestActionGroup[],
    people: RequestSubject[],
    assignLabel: string
  ): RequestActionGroup[] => {
    const assigned = new Set(
      covered
        .filter((group) => group.operationCode === 'device.assign')
        .flatMap((group) => group.targets.map((target) => target.device_requirement_key))
        .filter(Boolean) as string[]
    );

    return devices.flatMap((device) => {
      if (assigned.has(device.device_requirement_key)) return [];

      const holder = device.intended_holder_subject_key
        ? people.find((subject) => subject.key === device.intended_holder_subject_key)
        : device.intended_holder_client_user
          ? people.find((subject) => subject.clientUser === device.intended_holder_client_user)
          : undefined;

      if (!holder) return [];

      return [
        {
          groupKey: `grp:${newKey()}`,
          operationCode: 'device.assign',
          operationLabelSnapshot: assignLabel,
          domain: 'Device' as const,
          serviceItem: null,
          sourceScopeType: 'Person' as const,
          sourceScopeKey: holder.key,
          sourceScopeLabel: holder.fullName ?? '',
          selectedSubjectCount: 1,
          targets: [
            {
              subject_key: holder.key,
              client_user: holder.clientUser ?? null,
              requested_client_user: holder.requestedClientUser ?? null,
              full_name: holder.fullName ?? '',
              department: holder.department ?? null,
              target_scope: 'Device' as const,
              managed_device: null,
              device_requirement_key: device.device_requirement_key,
              requested_device: device.requested_device ?? null,
              device_label: device.display_label,
              source_service_assignment: null,
              requested_holder: holder.clientUser ?? null,
              requested_holder_subject_key: holder.kind === 'new' ? holder.key : null,
              requested_holder_requested_client_user:
                holder.kind === 'new' ? (holder.requestedClientUser ?? null) : null,
            },
          ],
          exclusions: [],
        },
      ];
    });
  };

  // ------------------------------------------------------------------ action groups
  const addActionGroup = (
    group: Omit<RequestActionGroup, 'groupKey'> | null,
    devices: RequestedDeviceDraft[] = [],
    options: { assignLabel?: string; holders?: HolderPerson[] } = {}
  ) => {
    const groupKey = `grp:${newKey()}`;
    const added = group
      ? [
          {
            ...group,
            groupKey,
            selectedSubjectCount:
              group.sourceScopeType === 'Person' ? group.selectedSubjectCount : scopeCount(group),
          },
        ]
      : [];
    const fresh = devices.filter(
      (device) =>
        !requestedDevices.some(
          (known) => known.device_requirement_key === device.device_requirement_key
        )
    );
    const joining = (options.holders ?? [])
      .filter(
        (person) =>
          fresh.some((device) => device.intended_holder_client_user === person.name) &&
          !subjects.some((subject) => subject.clientUser === person.name)
      )
      .map((person) => ({
        key: subjectKeyOf(person.name),
        kind: 'existing' as const,
        clientUser: person.name,
        fullName: person.full_name,
        department: person.department ?? undefined,
        email: person.email ?? undefined,
        selectionOrigin: 'Individual' as const,
      }));
    const assigns = assignGroupsFor(
      fresh,
      [...actionGroups, ...added],
      [...subjects, ...joining],
      options.assignLabel ?? 'Assign Device'
    );

    if (joining.length) setSubjects((current) => [...current, ...joining]);
    if (fresh.length) setRequestedDevices((current) => [...current, ...fresh]);
    setActionGroups((current) => [...current, ...assigns, ...added]);

    return groupKey;
  };

  const removeActionGroup = (groupKey: string) => {
    const next = actionGroups.filter((group) => group.groupKey !== groupKey);
    const used = referencedDevices(next, subjects);

    setActionGroups(next);
    setRequestedDevices((current) =>
      current.filter((device) => used.has(device.device_requirement_key))
    );
  };

  const reviewActionGroup = (
    groupKey: string,
    targets: RequestTarget[],
    exclusions: RequestExclusion[]
  ) =>
    setActionGroups((current) =>
      current.map((group) =>
        group.groupKey === groupKey
          ? { ...group, targets, exclusions, selectedSubjectCount: scopeCount(group) }
          : group
      )
    );

  const needsReview = (group: RequestActionGroup) =>
    group.sourceScopeType !== 'Person' && scopeCount(group) !== group.selectedSubjectCount;

  const reviewNeeded = actionGroups.some(needsReview);

  // ------------------------------------------------------------------ sending
  /** The people, as the server reads a snapshot. */
  const subjectDrafts = useMemo<RequestSubjectDraft[]>(
    () =>
      subjects.map((subject) => ({
        subject_key: subject.key,
        kind: subject.kind,
        client_user: subject.kind === 'existing' ? (subject.clientUser ?? null) : null,
        requested_client_user:
          subject.kind === 'new' ? (subject.requestedClientUser ?? null) : null,
        managed_device: subject.kind === 'device' ? (subject.managedDevice ?? null) : null,
        requested_device: subject.kind === 'device' ? (subject.requestedDevice ?? null) : null,
        device_requirement_key:
          subject.kind === 'device' ? (subject.deviceRequirementKey ?? null) : null,
        full_name: subject.fullName ?? '',
        department: subject.department ?? null,
        email: subject.email ?? null,
        username: subject.username ?? null,
        external_employee_id: subject.externalEmployeeId ?? null,
        start_date: subject.startDate ?? null,
        added_via: addedVia(subject),
        selection_label: subject.selectionLabel ?? null,
      })),
    [subjects]
  );

  const groupDrafts = useMemo<RequestActionGroupDraft[]>(
    () =>
      actionGroups.map((group) => ({
        group_key: group.groupKey,
        operation_code: group.operationCode,
        operation_label_snapshot: group.operationLabelSnapshot,
        domain: group.domain,
        service_item: group.serviceItem ?? null,
        source_scope_type: group.sourceScopeType,
        source_scope_key: group.sourceScopeKey ?? null,
        source_scope_label: group.sourceScopeLabel,
        selected_subject_count: group.selectedSubjectCount,
        targets: group.targets,
        exclusions: group.exclusions,
      })),
    [actionGroups]
  );

  const deviceDrafts = useMemo(() => {
    const used = referencedDevices(actionGroups);

    return requestedDevices.filter((device) => used.has(device.device_requirement_key));
  }, [requestedDevices, actionGroups]);

  const payload = useMemo<Omit<RequestPayload, 'name' | 'customer'>>(
    () => ({
      priority,
      details: details.trim() || undefined,
      requested_date: requestedDate || null,
      subjects: subjectDrafts,
      requested_devices: deviceDrafts,
      action_groups: groupDrafts,
    }),
    [priority, details, requestedDate, subjectDrafts, deviceDrafts, groupDrafts]
  );

  const canSave =
    !unrestorable && !locked && !edit && (subjects.length > 0 || actionGroups.length > 0);
  const canSend =
    !unrestorable && !locked && subjects.length > 0 && actionGroups.length > 0 && !reviewNeeded;

  const send = async () => {
    if (!canSend) return null;

    if (edit) {
      try {
        const updated = await update.mutateAsync({ ...payload, name: edit });

        onCreated?.(updated);

        return updated;
      } catch {
        return null;
      }
    }

    const created = await create.mutateAsync({ ...payload, name: draft || undefined });

    setDraft(null);
    setSubjects([]);
    setRequestedDevices([]);
    setActionGroups([]);
    onCreated?.(created);

    return created;
  };

  const putAside = async () => {
    if (!canSave) return null;

    const stored = await saveDraft.mutateAsync({ ...payload, name: draft || undefined });
    const names = canonicalNames(stored);

    setSubjects((current) =>
      current.map((subject) =>
        subject.kind === 'new' && names.people.has(subject.key)
          ? { ...subject, requestedClientUser: names.people.get(subject.key) }
          : subject
      )
    );
    setRequestedDevices((current) =>
      current.map((device) =>
        names.machines.has(device.device_requirement_key)
          ? { ...device, requested_device: names.machines.get(device.device_requirement_key) }
          : device
      )
    );
    setActionGroups((current) =>
      current.map((group) => ({
        ...group,
        targets: group.targets.map((target) => namedTarget(target, names)),
      }))
    );
    setDraft(stored.name);

    return stored;
  };

  const giveUp = async () => {
    if (draft) {
      await discardDraft.mutateAsync(draft);
      setDraft(null);
    }

    setSubjects([]);
    setRequestedDevices([]);
    setActionGroups([]);
  };

  return {
    subjects,
    subjectDrafts,
    requestedDevices,
    deviceDrafts,
    actionGroups,
    groupDrafts,
    addActionGroup,
    removeActionGroup,
    reviewActionGroup,
    needsReview,
    reviewNeeded,
    priority,
    setPriority,
    details,
    setDetails,
    requestedDate,
    setRequestedDate,
    draft,
    setDraft,
    addExistingSubject,
    addGroupSubjects,
    addNewSubject,
    addDeviceSubject,
    removeSubject,
    removeSubjectsFor,
    payload,
    canSave,
    canSend,
    unrestorable,
    send,
    putAside,
    giveUp,
    sending: create.isLoading || update.isLoading,
    saving: saveDraft.isLoading,
    reopening: Boolean(source) && !loaded && !saved.error,
    correcting: Boolean(correct),
    editing: edit ?? null,
    locked,
    /** the company a reopened draft or a corrected request belongs to */
    sourceCustomer: saved.data?.customer ?? null,
    error: (create.error || update.error || saveDraft.error || saved.error) as Error | null,
  };
};
