import { useEffect, useMemo, useState } from 'react';
import type { NewRequestLine, PortalRequestDetail, RequestAction } from '@/lib/api/portal';
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
  action: string;
  requestAction: string;
  actionLabel: string;
  serviceItem: string;
  serviceLabel: string;
  targetScope: 'User' | 'Device';
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
};

/** The person a group of intentions is about, whether or not they exist yet. */
export type RequestSubject = {
  key: string;
  kind: 'existing' | 'new';
  clientUser?: string;
  fullName?: string;
  department?: string;
  email?: string;
  /** optional: some customers know the account name they want, most do not */
  username?: string;
};

const newKey = () => Math.random().toString(36).slice(2, 10);

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
      const identity = `new:${line.new_user_full_name ?? ''}`;
      const existing = keyOfPerson.get(identity);

      if (existing) return existing;

      const key = newKey();
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

    const key = newKey();
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
      action: line.action,
      requestAction: line.request_action ?? '',
      actionLabel: line.action_label || line.action,
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
    });
  });

  return { subjects, intents, priority: saved.priority };
};

export const useRequestBuilder = (
  onCreated?: (created: { name: string }) => void,
  reopen?: string,
  correct?: string,
  /** the person a page sent us here about, so nobody searches for who they were just reading */
  about?: string
) => {
  const [subjects, setSubjects] = useState<RequestSubject[]>([]);
  const [intents, setIntents] = useState<RequestIntent[]>([]);
  const [priority, setPriority] = useState('Medium');
  const [defaultDate, setDefaultDate] = useState(today());
  const [draft, setDraft] = useState<string | null>(reopen ?? null);
  const [loaded, setLoaded] = useState(false);

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
    if (!source || loaded || !saved.data) return;

    const rebuilt = fromSavedRequest(saved.data);
    setSubjects(rebuilt.subjects);
    setIntents(rebuilt.intents);
    if (rebuilt.priority) setPriority(rebuilt.priority);
    setLoaded(true);
  }, [source, loaded, saved.data]);

  // ------------------------------------------------------------------ subjects
  const addExistingSubject = (person: {
    name: string;
    full_name: string;
    department?: string | null;
    email?: string | null;
  }) => {
    const already = subjects.find((subject) => subject.clientUser === person.name);

    if (already) return already.key;

    const key = newKey();
    setSubjects((current) => [
      ...current,
      {
        key,
        kind: 'existing',
        clientUser: person.name,
        fullName: person.full_name,
        department: person.department ?? undefined,
        email: person.email ?? undefined,
      },
    ]);

    return key;
  };

  const addNewSubject = () => {
    const key = newKey();
    setSubjects((current) => [...current, { key, kind: 'new' }]);

    return key;
  };

  const updateSubject = (key: string, patch: Partial<RequestSubject>) =>
    setSubjects((current) =>
      current.map((subject) => (subject.key === key ? { ...subject, ...patch } : subject))
    );

  const removeSubject = (key: string) => {
    setSubjects((current) => current.filter((subject) => subject.key !== key));
    setIntents((current) => current.filter((intent) => intent.subjectKey !== key));
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
      const line: NewRequestLine = {
        request_action: intent.requestAction,
        action: intent.action,
        target_scope: intent.targetScope,
        requested_service: intent.serviceItem,
        requested_effective_date: intent.requestedEffectiveDate || defaultDate,
        comment: intent.comment || undefined,
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
        line.new_user_full_name = subject.fullName;
        line.new_user_department = subject.department;
        line.new_user_email = subject.email;
        if (subject.username) line.new_user_username = subject.username;
        // a machine for somebody who does not exist yet is the technician's to identify
        if (intent.targetScope === 'Device' || intent.isNewDevice) {
          line.target_scope = 'User';
          line.is_new_device = 1;
        }

        return line;
      }

      if (intent.targetScope === 'Device') {
        line.managed_device = intent.managedDevice;
        line.requested_for_user = subject?.clientUser;

        if (intent.isNewDevice) {
          line.target_scope = 'User';
          line.is_new_device = 1;
          delete line.managed_device;
        }

        return line;
      }

      line.client_user = subject?.clientUser;

      return line;
    });
  }, [intents, subjects, defaultDate]);

  const payload = () => ({ priority, lines });

  const canSend = subjects.length > 0 && intents.length > 0;

  const send = async () => {
    if (!canSend) return null;

    const created = await create.mutateAsync({ ...payload(), name: draft || undefined });

    setDraft(null);
    setSubjects([]);
    setIntents([]);
    onCreated?.(created);

    return created;
  };

  const putAside = async () => {
    if (!intents.length) return null;

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
  };

  return {
    subjects,
    intents,
    priority,
    setPriority,
    defaultDate,
    setDefaultDate,
    draft,
    setDraft,
    addExistingSubject,
    addNewSubject,
    updateSubject,
    removeSubject,
    addIntent,
    updateIntent,
    removeIntent,
    intentsOf,
    isAsked,
    askedOn,
    lines,
    canSend,
    send,
    putAside,
    giveUp,
    sending: create.isLoading,
    saving: saveDraft.isLoading,
    reopening: Boolean(source) && !loaded,
    correcting: Boolean(correct),
    error: (create.error || saveDraft.error) as Error | null,
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
    personal_services: { current: { assignment: string; service_item: string; label: string; status: string; allowed_request_actions: RequestAction[]; pending_request: string | null }[] };
    devices: {
      name: string;
      services: {
        current: { assignment: string; service_item: string; label: string; status: string; allowed_request_actions: RequestAction[]; pending_request: string | null }[];
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

  const allowed = running.allowed_request_actions.some(
    (action) => action.action_type === intent.action
  );

  return allowed
    ? null
    : `${running.label} is now ${running.status.toLowerCase()}, so ${intent.actionLabel} no longer applies.`;
};

/** The act a button stands for, as the administrator named it. */
export const actionLabel = (action: RequestAction) => action.title || action.action_type;
