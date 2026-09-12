import { useMemo, useState } from 'react';
import type { NewRequestLine, RequestAction } from '@/lib/api/portal';
import {
  useCreateServiceRequest,
  useDiscardRequestDraft,
  useSaveRequestDraft,
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
};

/** The person a group of intentions is about, whether or not they exist yet. */
export type RequestSubject = {
  key: string;
  kind: 'existing' | 'new';
  clientUser?: string;
  fullName?: string;
  department?: string;
  email?: string;
};

const newKey = () => Math.random().toString(36).slice(2, 10);

export const today = () => new Date().toISOString().slice(0, 10);

export const useRequestBuilder = (onCreated?: (created: { name: string }) => void) => {
  const [subjects, setSubjects] = useState<RequestSubject[]>([]);
  const [intents, setIntents] = useState<RequestIntent[]>([]);
  const [priority, setPriority] = useState('Medium');
  const [defaultDate, setDefaultDate] = useState(today());
  const [draft, setDraft] = useState<string | null>(null);

  const create = useCreateServiceRequest();
  const saveDraft = useSaveRequestDraft();
  const discardDraft = useDiscardRequestDraft();

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

      if (subject?.kind === 'new') {
        line.is_new_user = 1;
        line.new_user_full_name = subject.fullName;
        line.new_user_department = subject.department;
        line.new_user_email = subject.email;
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
    error: (create.error || saveDraft.error) as Error | null,
  };
};

/** The act a button stands for, as the administrator named it. */
export const actionLabel = (action: RequestAction) => action.title || action.action_type;
