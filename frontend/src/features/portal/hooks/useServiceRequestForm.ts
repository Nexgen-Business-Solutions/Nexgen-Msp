import { useEffect, useMemo, useState } from 'react';
import type { NewRequestLine, PortalRequestDetail, ServiceRequestDetail } from '@/lib/api/portal';
import {
  useCatalogue,
  usePortalFilterOptions,
  useServiceRequest,
  useUserChoices,
  useDeviceChoices,
  useCreateServiceRequest,
  useDiscardRequestDraft,
  useRequestActions,
  useSaveRequestDraft,
} from './usePortal';

const PRIORITY_OPTIONS = [
  { value: 'Low', label: 'Low', description: 'No rush' },
  { value: 'Medium', label: 'Medium', description: 'Standard pace' },
  { value: 'High', label: 'High', description: 'Needs attention' },
  { value: 'Urgent', label: 'Urgent', description: 'Business stopped' },
];

export type FormLine = {
  key: string;
  action: string;
  isNewUser: boolean;
  client_user: string;
  new_user_full_name: string;
  new_user_department: string;
  new_user_email: string;
  new_user_username: string;
  services: string[];
  managed_device: string;
  new_device_label: string;
  new_device_type: string;
  new_device_serial: string;
  requested_effective_date: string;
  comment: string;
};

export type LineErrors = Partial<Record<keyof FormLine, string>>;

const today = () => new Date().toISOString().slice(0, 10);

let lineCounter = 0;

/** What a "raise a request about this" link carries over from a listing. */
export type LineSeed = { client_user?: string; managed_device?: string; service?: string };

const emptyLine = (seed?: LineSeed): FormLine => {
  lineCounter += 1;
  return {
    key: `line-${lineCounter}`,
    action: '',
    isNewUser: false,
    client_user: seed?.client_user ?? '',
    new_user_full_name: '',
    new_user_department: '',
    new_user_email: '',
    new_user_username: '',
    services: seed?.service ? [seed.service] : [],
    managed_device: seed?.managed_device ?? '',
    new_device_label: '',
    new_device_type: '',
    new_device_serial: '',
    requested_effective_date: today(),
    comment: '',
  };
};

export const NEW_DEVICE = '__new_device__';

const validateLine = (line: FormLine, deviceServices: Set<string>): LineErrors => {
  const errors: LineErrors = {};

  if (line.isNewUser) {
    if (!line.new_user_full_name.trim()) errors.new_user_full_name = 'Enter the full name.';
    // the address is what a portal invitation is sent to, so a typo is worth catching here
    if (line.new_user_email.trim() && !/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(line.new_user_email.trim()))
      errors.new_user_email = 'That does not look like an email address.';
  } else if (!line.client_user) {
    errors.client_user = 'Select a user.';
  }

  if (!line.action) errors.action = 'Select an action.';
  if (!line.services.length) errors.services = 'Select at least one service.';

  const needsDevice = line.services.some((service) => deviceServices.has(service));

  if (needsDevice) {
    // the customer says whether the machine is one we already hold or a new one; what it is
    // called and what is engraved on it is collected by whoever carries the work out
    if (!line.managed_device) {
      errors.managed_device = 'Say whether this is a machine we already hold, or a new one.';
    }
  }

  return errors;
};

const toPayloadLines = (line: FormLine, deviceServices: Set<string>): NewRequestLine[] =>
  line.services.map((service) => {
    const wantsDevice = deviceServices.has(service);
    const toRegister = wantsDevice && line.managed_device === NEW_DEVICE;
    const onDevice = wantsDevice && !toRegister && !line.isNewUser;

    return {
      request_action: line.action || undefined,
      target_scope: onDevice ? 'Device' : 'User',
      is_new_user: line.isNewUser ? 1 : 0,
      is_new_device: toRegister ? 1 : 0,
      new_device_label: toRegister ? line.new_device_label.trim() : undefined,
      new_device_type: toRegister ? line.new_device_type || undefined : undefined,
      // sent for a machine we already hold too: it is how a serial we never had gets filled
      new_device_serial: line.new_device_serial.trim() || undefined,
      client_user: line.isNewUser || onDevice ? undefined : line.client_user,
      managed_device: onDevice ? line.managed_device : undefined,
      new_user_full_name: line.isNewUser ? line.new_user_full_name.trim() : undefined,
      new_user_email: line.isNewUser ? line.new_user_email.trim() || undefined : undefined,
      new_user_department: line.isNewUser
        ? line.new_user_department.trim() || undefined
        : undefined,
      new_user_username: line.new_user_username.trim() || undefined,
      requested_service: service,
      requested_effective_date: line.requested_effective_date || undefined,
      comment: line.comment || undefined,
    };
  });

/**
 * Rebuild the form's blocks from a saved draft.
 *
 * The document holds one line per service; the form groups the services of one target into
 * a single block, so the lines are folded back the way they were written.
 */
const toFormLines = (detail: PortalRequestDetail): FormLine[] => {
  const blocks = new Map<string, FormLine>();

  for (const line of detail.lines) {
    const key = [
      line.request_action ?? '',
      line.client_user ?? '',
      line.managed_device ?? '',
      line.is_new_user ? `new:${line.new_user_full_name ?? ''}` : '',
      line.is_new_device ? 'newdevice' : '',
      line.requested_effective_date ?? '',
      line.comment ?? '',
    ].join('|');

    const existing = blocks.get(key);

    if (existing) {
      if (line.requested_service) existing.services.push(line.requested_service);
      continue;
    }

    const block = emptyLine();

    block.action = line.request_action ?? '';
    block.isNewUser = Boolean(line.is_new_user);
    block.client_user = line.client_user ?? '';
    block.new_user_full_name = line.new_user_full_name ?? '';
    block.new_user_department = line.new_user_department ?? '';
    block.new_user_email = line.new_user_email ?? '';
    block.new_user_username = line.new_user_username ?? '';
    block.services = line.requested_service ? [line.requested_service] : [];
    block.managed_device = line.is_new_device ? NEW_DEVICE : line.managed_device ?? '';
    block.new_device_label = line.new_device_label ?? '';
    block.new_device_type = line.new_device_type ?? '';
    block.new_device_serial = line.new_device_serial ?? '';
    block.requested_effective_date = line.requested_effective_date ?? today();
    block.comment = line.comment ?? '';

    blocks.set(key, block);
  }

  return [...blocks.values()];
};

export const useServiceRequestForm = (
  onCreated?: (request: ServiceRequestDetail) => void,
  seed?: LineSeed,
  reopen?: string,
  /** A request to start from — a refused one, corrected and sent again as a new one. */
  copyFrom?: string
) => {
  const [priority, setPriority] = useState<string>('Medium');
  const [lines, setLines] = useState<FormLine[]>([emptyLine(seed)]);
  const actions = useRequestActions();
  const [touched, setTouched] = useState(false);

  const [draft, setDraft] = useState<string | null>(reopen ?? null);
  const [loaded, setLoaded] = useState(false);
  const source = reopen ?? copyFrom;
  const saved = useServiceRequest(source);
  const catalogue = useCatalogue();
  const filterOptions = usePortalFilterOptions();
  const users = useUserChoices();
  const devices = useDeviceChoices();
  const mutation = useCreateServiceRequest();
  const draftMutation = useSaveRequestDraft();
  const discardMutation = useDiscardRequestDraft();

  const deviceServices = useMemo(
    () =>
      new Set(
        (catalogue.data?.items ?? [])
          // 'Both' is a device service too — the server treats it that way everywhere, and
          // leaving it out here meant such a request never asked which machine it was for
          .filter((item) => item.scope === 'Device' || item.scope === 'Both')
          .map((item) => item.name)
      ),
    [catalogue.data]
  );

  const serviceOptions = useMemo(
    () =>
      (catalogue.data?.items ?? []).map((item) => ({
        value: item.name,
        label: item.item_name || item.name,
      })),
    [catalogue.data]
  );

  const userOptions = useMemo(
    () =>
      (users.data ?? []).map((row) => {
        // someone who has left can legitimately be the subject of a request — closing
        // their services, for one — so they stay in the list, flagged rather than hidden
        const gone = ['Disabled', 'Archived'].includes(row.lifecycle_status);
        const facts = [
          row.email,
          row.department,
          gone
            ? `${row.lifecycle_status.toLowerCase()}${
                row.disabled_date ? ` since ${String(row.disabled_date).slice(0, 10)}` : ''
              }`
            : null,
        ].filter(Boolean);

        return {
          value: row.name,
          label: row.full_name,
          description: facts.join(' · ') || undefined,
        };
      }),
    [users.data]
  );

  const usersByName = useMemo(
    () => new Map((users.data ?? []).map((row) => [row.name, row])),
    [users.data]
  );

  const errors = useMemo(
    () => lines.map((line) => validateLine(line, deviceServices)),
    [lines, deviceServices]
  );
  const isValid = errors.every((lineErrors) => Object.keys(lineErrors).length === 0);
  const totalServices = lines.reduce((sum, line) => sum + line.services.length, 0);

  const addLine = () => setLines((current) => [...current, emptyLine()]);

  const removeLine = (key: string) =>
    setLines((current) =>
      current.length <= 1 ? current : current.filter((line) => line.key !== key)
    );

  const duplicateLine = (key: string) =>
    setLines((current) => {
      const source = current.find((line) => line.key === key);
      if (!source) return current;
      return [...current, { ...source, key: emptyLine().key }];
    });

  const updateLine = <K extends keyof FormLine>(key: string, field: K, value: FormLine[K]) =>
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, [field]: value };

        if (field === 'isNewUser') {
          next.managed_device = '';
          if (value) {
            next.client_user = '';
          } else {
            next.new_user_full_name = '';
            next.new_user_department = '';
            next.new_user_email = '';
          }
        }

        if (field === 'client_user') next.managed_device = '';
        if (field === 'managed_device' && value !== NEW_DEVICE) next.new_device_label = '';

        return next;
      })
    );

  const reset = () => {
    setPriority('Medium');
    setLines([emptyLine()]);
    setTouched(false);
    mutation.reset();
  };

  // a draft opened from the listing, or a refused request being corrected, fills the form
  // once, then behaves like any other
  useEffect(() => {
    if (!source || loaded || !saved.data) return;

    setPriority(saved.data.priority || 'Medium');
    setLines(toFormLines(saved.data));
    setLoaded(true);
  }, [source, loaded, saved.data]);

  const payload = () => ({
    priority,
    lines: lines.flatMap((line) => toPayloadLines(line, deviceServices)),
  });

  const submit = async () => {
    setTouched(true);
    if (!isValid) return null;

    // a draft being sent grows into the request; there is never a second document
    const created = await mutation.mutateAsync({ ...payload(), name: draft || undefined });

    setDraft(null);
    reset();
    onCreated?.(created);
    return created;
  };

  /** Put it aside, half written. Only its author will see it until it is sent. */
  const save = async () => {
    if (!lines.some((line) => line.services.length)) return null;

    const saved = await draftMutation.mutateAsync({ ...payload(), name: draft || undefined });
    setDraft(saved.name);

    return saved;
  };

  /** Give it up. What was put aside goes with it. */
  const discard = async () => {
    if (draft) {
      await discardMutation.mutateAsync(draft);
      setDraft(null);
    }

    reset();
  };

  return {
    priority,
    setPriority,
    lines,
    errors,
    touched,
    isValid,
    totalServices,
    addLine,
    removeLine,
    duplicateLine,
    updateLine,
    reset,
    submit,
    save,
    reopening: Boolean(source) && !loaded,
    discard,
    draft,
    // a request is made of services: until one is picked there is nothing to put aside
    hasSomething: lines.some((line) => line.services.length > 0),
    submitting: mutation.isLoading,
    saving: draftMutation.isLoading,
    discarding: discardMutation.isLoading,
    submitError: mutation.error || draftMutation.error,
    options: {
      actions: (actions.data ?? []).map((entry) => ({
        value: entry.name,
        label: entry.title,
        description: entry.description ?? undefined,
      })),
      // a brand new person has nothing to change, suspend or remove
      actionsForNewUser: (actions.data ?? [])
        .filter((entry) => entry.action_type === 'Add')
        .map((entry) => ({
          value: entry.name,
          label: entry.title,
          description: entry.description ?? undefined,
        })),
      priorities: PRIORITY_OPTIONS,
      // read from the doctype rather than written out here, so a type added later shows up
      deviceTypes: (filterOptions.data?.device_types ?? []).map((value) => ({
        value,
        label: value,
      })),
      services: serviceOptions,
      users: userOptions,
    },
    deviceServices,
    userFor: (clientUser: string) => usersByName.get(clientUser),
    // the person is only an ordering hint: the machines belong to the company, and a
    // request is often raised before anyone has been picked — or for a brand new joiner
    devicesFor: (clientUser?: string) =>
      (devices.data ?? [])
        // every machine of the company, held or not: a request is often about one somebody
        // else has, and whoever holds it is named so the right one is picked
        .slice()
        .sort((a, b) => {
          const mine = Number(b.assigned_client_user === clientUser)
            - Number(a.assigned_client_user === clientUser);
          return mine || a.hostname.localeCompare(b.hostname);
        })
        .map((row) => ({
          value: row.name,
          label: row.hostname,
          description:
            [
              clientUser && row.assigned_client_user === clientUser
                ? 'Theirs'
                : row.assigned_user_name || 'Nobody holds it',
              row.status !== 'Active' ? row.status : null,
              row.device_type,
              row.serial_number,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
        })),
    deviceFor: (device: string) => (devices.data ?? []).find((row) => row.name === device),
    newDeviceValue: NEW_DEVICE,
    loadingOptions: catalogue.isLoading || users.isLoading || devices.isLoading,
  };
};
