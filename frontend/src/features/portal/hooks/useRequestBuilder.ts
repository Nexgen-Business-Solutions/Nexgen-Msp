import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  NewRequestLine,
  PortalRequestDetail,
  RequestActionGroupDraft,
  RequestExclusion,
  RequestOperation,
  RequestSubjectDraft,
  RequestTarget,
} from '@/lib/api/portal';
import {
  useCreateServiceRequest,
  useDiscardRequestDraft,
  useRequestSubjectContext,
  useSaveRequestDraft,
  useServiceRequest,
} from './usePortal';

/**
 * One thing the customer wants changed. A request is a list of these, and each one becomes
 * exactly one line — never a service list under a single shared action, which is what made
 * the old form able to ask for things that could not be carried out.
 */
export type RequestIntent = {
  key: string;
  subjectKey: string;
  /** the operation asked for, as the application performs it */
  operationCode: string;
  actionLabel: string;
  serviceItem: string;
  serviceLabel: string;
  targetScope: 'User' | 'Device';
  /** who should hold the machine, for an operation that decides that */
  requestedHolder?: string;
  requestedHolderLabel?: string;
  /** who holds it today, so the review reads as a handover rather than a name */
  currentHolder?: string;
  currentHolderLabel?: string;
  sourceServiceAssignment?: string;
  managedDevice?: string;
  deviceLabel?: string;
  isNewDevice?: boolean;
  requestedQuantity?: number;
  requestedEffectiveDate?: string;
  comment?: string;
  /** never asked for, but kept when the customer happens to know it */
  deviceHostname?: string;
  deviceSerial?: string;
  deviceType?: string;
  /** a machine to settle: one the company already has, a new one, or left to the technician */
  machineSource?: 'existing' | 'new';
};

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
  kind: 'existing' | 'new';
  clientUser?: string;
  fullName?: string;
  department?: string;
  email?: string;
  /** the snapshot this person came from, kept on every line they end up on */
  selectionOrigin?: SelectionOrigin;
  selectionGroupKey?: string;
  selectionLabel?: string;
  selectionSnapshotAt?: string;
  /** optional: some customers know the account name they want, most do not */
  username?: string;
  /** for somebody with no machine: which one the customer suggests, if any */
  machineChoice?: 'unspecified' | 'stock' | 'new';
  machineDevice?: string;
  /** a new machine the customer already knows something about — none of it is required */
  machineSerial?: string;
  machineHostname?: string;
  machineType?: string;
};

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

/** Whether an operation acts on the machine itself rather than on a service. */
export const isMachineOperation = (code: string) => code.startsWith('device.');

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Rebuild the subjects and intentions a saved request stands for.
 *
 * A draft is reopened, and a refused request is corrected and sent again — in both cases
 * what was stored is a list of lines, and the builder thinks in people and intentions.
 */
export const fromSavedRequest = (saved: PortalRequestDetail) => {
  const subjects: RequestSubject[] = [];
  const intents: RequestIntent[] = [];
  const keyOfPerson = new Map<string, string>();

  const subjectFor = (line: PortalRequestDetail['lines'][number]) => {
    if (line.is_new_user) {
      // each new person written into the request is their own subject
      // A name is not an identity: two future colleagues can have the same name. Lines
      // belonging to one person repeat the same supplied details, so that complete tuple
      // preserves continuity without folding distinct people together.
      const identity = line.subject_key
        ? `saved:${line.subject_key}`
        : `legacy:${JSON.stringify([
            line.new_user_full_name ?? '',
            line.new_user_department ?? '',
            line.new_user_email ?? '',
            line.new_user_username ?? '',
          ])}`;
      const existing = keyOfPerson.get(identity);

      if (existing) return existing;

      const key = line.subject_key || subjectKeyOf();
      keyOfPerson.set(identity, key);
      subjects.push({
        key,
        kind: 'new',
        fullName: line.new_user_full_name ?? undefined,
        department: line.new_user_department ?? undefined,
        email: line.new_user_email ?? undefined,
        username: line.new_user_username ?? undefined,
      });

      return key;
    }

    const person = line.requested_for_user || line.client_user;
    const identity = `existing:${person ?? ''}`;
    const existing = keyOfPerson.get(identity);

    if (existing) return existing;

    const key = line.subject_key || subjectKeyOf(person ?? undefined);
    keyOfPerson.set(identity, key);
    subjects.push({
      key,
      kind: 'existing',
      clientUser: person ?? undefined,
      fullName: line.user_name ?? person ?? undefined,
      department: line.department ?? undefined,
    });

    return key;
  };

  saved.lines.forEach((line) => {
    intents.push({
      key: newKey(),
      subjectKey: subjectFor(line),
      operationCode: line.operation_code ?? '',
      actionLabel: line.operation_label_snapshot || line.action_label || line.action,
      serviceItem: line.requested_service ?? '',
      serviceLabel: line.service_name || line.requested_service || '',
      targetScope: line.managed_device ? ('Device' as const) : ('User' as const),
      sourceServiceAssignment: line.source_service_assignment ?? undefined,
      managedDevice: line.managed_device ?? undefined,
      deviceLabel: line.hostname ?? undefined,
      isNewDevice: Boolean(line.is_new_device),
      requestedQuantity: line.requested_quantity ?? undefined,
      requestedEffectiveDate: line.requested_effective_date ?? undefined,
      comment: line.comment ?? undefined,
      deviceHostname: line.new_device_label ?? undefined,
      deviceSerial: line.new_device_serial ?? undefined,
      deviceType: line.new_device_type ?? undefined,
      requestedHolder: line.requested_holder ?? undefined,
      requestedHolderLabel: line.requested_holder_name ?? undefined,
      currentHolder: line.requested_for_user ?? undefined,
      currentHolderLabel: line.device_holder ?? undefined,
    });
  });

  // a request written before the details were one note carried them line by line: they are
  // gathered into the single note rather than lost the next time it is saved
  const earlier = [...new Set(saved.lines.map((line) => (line.comment ?? '').trim()).filter(Boolean))];

  return {
    subjects,
    intents,
    priority: saved.priority,
    details: saved.details || earlier.join('\n'),
  };
};

export const useRequestBuilder = (
  onCreated?: (created: { name: string }) => void,
  reopen?: string,
  correct?: string,
  /** the person a page sent us here about, so nobody searches for who they were just reading */
  about?: string,
  /** a machine nobody holds: the request starts about somebody still to be described */
  startNew?: boolean,
  /** an act on a machine, brought here from that machine's page */
  seed?: RequestSeed | null
) => {
  const [subjects, setSubjects] = useState<RequestSubject[]>([]);
  const [intents, setIntents] = useState<RequestIntent[]>([]);
  const [actionGroups, setActionGroups] = useState<RequestActionGroup[]>([]);
  const [priority, setPriority] = useState('Medium');
  const [details, setDetails] = useState('');
  const [defaultDate, setDefaultDate] = useState(today());
  const [draft, setDraft] = useState<string | null>(reopen ?? null);
  const [loaded, setLoaded] = useState(false);
  const [staleIntentKeys, setStaleIntentKeys] = useState<Set<string>>(() => new Set());

  const create = useCreateServiceRequest();
  const saveDraft = useSaveRequestDraft();
  const discardDraft = useDiscardRequestDraft();

  // a draft picked up again, or a refused request being corrected: the same document in
  // the first case, a fresh one in the second
  const source = reopen ?? correct;
  const saved = useServiceRequest(source);

  // arriving from somebody's page: they are the subject, picked for us
  const seeded = useRequestSubjectContext(source || !about ? undefined : about);

  useEffect(() => {
    if (source || loaded || !seeded.data) return;

    const person = seeded.data.user;
    setSubjects([
      {
        key: newKey(),
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

    const key = newKey();
    setSubjects([
      {
        key,
        kind: 'existing',
        clientUser: seed.subject.clientUser,
        fullName: seed.subject.fullName,
        department: seed.subject.department ?? undefined,
      },
    ]);
    setIntents([
      {
        key: newKey(),
        subjectKey: key,
        operationCode: seed.operationCode,
        actionLabel: seed.actionLabel,
        serviceItem: '',
        serviceLabel: seed.deviceLabel,
        targetScope: 'Device',
        managedDevice: seed.managedDevice,
        deviceLabel: seed.deviceLabel,
        requestedHolder: seed.requestedHolder,
        requestedHolderLabel: seed.requestedHolderLabel,
        currentHolder: seed.currentHolder,
        currentHolderLabel: seed.currentHolderLabel,
        requestedEffectiveDate: seed.requestedEffectiveDate,
        comment: seed.comment,
      },
    ]);
    setLoaded(true);
  }, [source, loaded, seed]);

  useEffect(() => {
    if (source || about || loaded || !startNew) return;

    setSubjects([{ key: subjectKeyOf(), kind: 'new' }]);
    setLoaded(true);
  }, [source, about, loaded, startNew]);

  useEffect(() => {
    if (!source || loaded || !saved.data) return;

    const rebuilt = fromSavedRequest(saved.data);
    setSubjects(rebuilt.subjects);
    setIntents(rebuilt.intents);
    if (rebuilt.priority) setPriority(rebuilt.priority);
    setDetails(rebuilt.details);
    setLoaded(true);
  }, [source, loaded, saved.data]);

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
    setSubjects((current) => [
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
    ]);

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

  const addNewSubject = () => {
    const key = subjectKeyOf();
    setSubjects((current) => [...current, { key, kind: 'new' }]);

    return key;
  };

  const updateSubject = (key: string, patch: Partial<RequestSubject>) =>
    setSubjects((current) =>
      current.map((subject) => (subject.key === key ? { ...subject, ...patch } : subject))
    );

  /** Take the people a refusal named out of the request, and everything asked for them. */
  const removeSubjectsFor = (clientUsers: string[]) => {
    const unwanted = new Set(clientUsers);
    const keys = new Set(
      subjects.filter((subject) => unwanted.has(subject.clientUser ?? '')).map((s) => s.key)
    );

    setSubjects((current) => current.filter((subject) => !keys.has(subject.key)));
    setIntents((current) => current.filter((intent) => !keys.has(intent.subjectKey)));
  };

  const removeSubject = (key: string) => {
    setSubjects((current) => current.filter((subject) => subject.key !== key));
    setIntents((current) => current.filter((intent) => intent.subjectKey !== key));
    setActionGroups((current) =>
      current
        .map((group) => ({
          ...group,
          targets: group.targets.filter((target) => target.subject_key !== key),
          exclusions: group.exclusions.filter((row) => row.subject_key !== key),
        }))
        .filter((group) => group.targets.length > 0)
    );
  };

  // ------------------------------------------------------------------ intents
  const addIntent = (intent: Omit<RequestIntent, 'key'>) => {
    setIntents((current) => [...current, { ...intent, key: newKey() }]);
  };

  const updateIntent = (key: string, patch: Partial<RequestIntent>) =>
    setIntents((current) =>
      current.map((intent) => (intent.key === key ? { ...intent, ...patch } : intent))
    );

  const removeIntent = (key: string) =>
    setIntents((current) => current.filter((intent) => intent.key !== key));

  // ------------------------------------------------------------------ action groups
  const addActionGroup = (group: Omit<RequestActionGroup, 'groupKey'>) => {
    const groupKey = `grp:${newKey()}`;

    setActionGroups((current) => [...current, { ...group, groupKey }]);

    return groupKey;
  };

  const removeActionGroup = (groupKey: string) =>
    setActionGroups((current) => current.filter((group) => group.groupKey !== groupKey));

  const reportStaleIntents = useCallback((subjectIntentKeys: string[], staleKeys: string[]) => {
    setStaleIntentKeys((current) => {
      const next = new Set(current);
      subjectIntentKeys.forEach((key) => next.delete(key));
      staleKeys.forEach((key) => next.add(key));
      return next;
    });
  }, []);

  const intentsOf = (subjectKey: string) =>
    intents.filter((intent) => intent.subjectKey === subjectKey);

  /** Whether this exact thing has already been asked for in this request. */
  const isAsked = (subjectKey: string, serviceItem: string, target?: string) =>
    intents.some(
      (intent) =>
        intent.subjectKey === subjectKey &&
        intent.serviceItem === serviceItem &&
        (intent.managedDevice ?? null) === (target ?? null)
    );

  const askedOn = (assignment: string) =>
    intents.find((intent) => intent.sourceServiceAssignment === assignment);

  // ------------------------------------------------------------------ sending
  const lines = useMemo<NewRequestLine[]>(() => {
    const bySubject = new Map(subjects.map((subject) => [subject.key, subject]));

    return intents.map((intent) => {
      const subject = bySubject.get(intent.subjectKey);

      // an act on the machine itself names the machine and, when it decides that, who is
      // to hold it: no service is involved at all
      if (isMachineOperation(intent.operationCode)) {
        return {
          operation_code: intent.operationCode,
          target_scope: 'Device',
          managed_device: intent.managedDevice,
          requested_holder: intent.requestedHolder,
          requested_effective_date: intent.requestedEffectiveDate || defaultDate,
          comment: intent.comment,
        };
      }

      const line: NewRequestLine = {
        operation_code: intent.operationCode,
        target_scope: intent.targetScope,
        requested_service: intent.serviceItem,
        requested_effective_date: intent.requestedEffectiveDate || defaultDate,
        selection_origin: subject?.selectionOrigin ?? 'Individual',
        selection_group_key: subject?.selectionGroupKey,
        selection_label: subject?.selectionLabel,
        selection_snapshot_at: subject?.selectionSnapshotAt,
      };

      if (intent.requestedQuantity) line.requested_quantity = intent.requestedQuantity;
      if (intent.sourceServiceAssignment) {
        line.source_service_assignment = intent.sourceServiceAssignment;
      }

      // whatever the customer knew is carried for whoever does the work; none of it is
      // written to a person or a machine by sending the request
      if (intent.deviceHostname) line.new_device_label = intent.deviceHostname;
      if (intent.deviceSerial) line.new_device_serial = intent.deviceSerial;
      if (intent.deviceType) line.new_device_type = intent.deviceType;

      if (subject?.kind === 'new') {
        line.is_new_user = 1;
        line.subject_key = `new-user:request:${subject.key}`;
        line.new_user_full_name = subject.fullName;
        line.new_user_department = subject.department;
        line.new_user_email = subject.email;
        if (subject.username) line.new_user_username = subject.username;
        // a machine for somebody who does not exist yet is the technician's to identify,
        // and the line stays about the machine
        if (intent.targetScope === 'Device' || intent.isNewDevice) {
          line.target_scope = 'Device';
          line.is_new_device = 1;
        }

        return line;
      }

      if (intent.targetScope === 'Device') {
        line.managed_device = intent.managedDevice;
        line.requested_for_user = subject?.clientUser;

        if (intent.isNewDevice) {
          line.is_new_device = 1;
          delete line.managed_device;
        }

        return line;
      }

      line.client_user = subject?.clientUser;

      return line;
    });
  }, [intents, subjects, defaultDate]);

  /** The people, as the server reads a snapshot. */
  const subjectDrafts = useMemo<RequestSubjectDraft[]>(
    () =>
      subjects.map((subject) => ({
        subject_key: subject.key,
        client_user: subject.clientUser ?? null,
        is_new_user: subject.kind === 'new',
        full_name: subject.fullName,
        department: subject.department ?? null,
        email: subject.email ?? null,
        username: subject.username ?? null,
        added_via:
          subject.kind === 'new'
            ? 'New'
            : subject.selectionOrigin === 'Department'
              ? 'Department'
              : subject.selectionOrigin === 'Company'
                ? 'Company'
                : 'Existing',
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

  /** How many concrete targets the whole request stands for. */
  const targetCount = actionGroups.reduce((total, group) => total + group.targets.length, 0);

  const payload = () =>
    actionGroups.length
      ? {
          priority,
          details: details.trim() || undefined,
          subjects: subjectDrafts,
          action_groups: groupDrafts,
        }
      : { priority, lines, details: details.trim() || undefined };

  const hasStaleIntents = intents.some((intent) => staleIntentKeys.has(intent.key));
  const canSend =
    subjects.length > 0 && (actionGroups.length > 0 || intents.length > 0) && !hasStaleIntents;

  const send = async () => {
    if (!canSend) return null;

    const created = await create.mutateAsync({ ...payload(), name: draft || undefined });

    setDraft(null);
    setSubjects([]);
    setIntents([]);
    setActionGroups([]);
    onCreated?.(created);

    return created;
  };

  const putAside = async () => {
    if (!intents.length && !actionGroups.length && !subjects.length) return null;

    const saved = await saveDraft.mutateAsync({ ...payload(), name: draft || undefined });
    setDraft(saved.name);

    return saved;
  };

  const giveUp = async () => {
    if (draft) {
      await discardDraft.mutateAsync(draft);
      setDraft(null);
    }

    setSubjects([]);
    setIntents([]);
    setActionGroups([]);
  };

  return {
    subjects,
    intents,
    subjectDrafts,
    actionGroups,
    addActionGroup,
    removeActionGroup,
    targetCount,
    priority,
    setPriority,
    details,
    setDetails,
    defaultDate,
    setDefaultDate,
    draft,
    setDraft,
    addExistingSubject,
    addGroupSubjects,
    addNewSubject,
    updateSubject,
    removeSubject,
    removeSubjectsFor,
    addIntent,
    updateIntent,
    removeIntent,
    intentsOf,
    isAsked,
    askedOn,
    reportStaleIntents,
    lines,
    canSend,
    hasStaleIntents,
    send,
    putAside,
    giveUp,
    sending: create.isLoading,
    saving: saveDraft.isLoading,
    reopening: Boolean(source) && !loaded && !saved.error,
    correcting: Boolean(correct),
    /** the company a reopened draft or a corrected request belongs to */
    sourceCustomer: saved.data?.customer ?? null,
    error: (create.error || saveDraft.error || saved.error) as Error | null,
  };
};

/**
 * Whether an intention written earlier still makes sense against what is true now.
 *
 * A draft can sit for days: somebody else may have activated the very service it wanted to
 * add, or resolved the one it wanted to suspend. The screen says so rather than letting the
 * request be sent into a refusal.
 */
export const staleReason = (
  intent: RequestIntent,
  context?: {
    personal_services: { current: { assignment: string; service_item: string; label: string; status: string; allowed_operations: RequestOperation[]; pending_request: string | null }[] };
    devices: {
      name: string;
      services: {
        current: { assignment: string; service_item: string; label: string; status: string; allowed_operations: RequestOperation[]; pending_request: string | null }[];
      };
    }[];
  }
): string | null => {
  if (!context) return null;

  const current = [
    ...context.personal_services.current.map((row) => ({ ...row, device: null as string | null })),
    ...context.devices.flatMap((device) =>
      device.services.current.map((row) => ({ ...row, device: device.name }))
    ),
  ];

  if (!intent.sourceServiceAssignment) {
    const live = current.find(
      (row) =>
        row.service_item === intent.serviceItem &&
        (row.device ?? undefined) === (intent.managedDevice ?? undefined)
    );

    return live
      ? `This change is no longer available because ${live.label} is now ${live.status.toLowerCase()}.`
      : null;
  }

  const running = current.find((row) => row.assignment === intent.sourceServiceAssignment);

  if (!running) {
    return `${intent.serviceLabel} is no longer running, so it cannot be ${intent.actionLabel.toLowerCase()}.`;
  }

  if (running.pending_request) {
    return `${running.label} is already being changed by request ${running.pending_request}.`;
  }

  const allowed = running.allowed_operations.some(
    (operation) => operation.code === intent.operationCode
  );

  return allowed
    ? null
    : `${running.label} is now ${running.status.toLowerCase()}, so ${intent.actionLabel} no longer applies.`;
};
