import { useMemo, useState } from 'react';
import type { NewRequestLine, ServiceRequestDetail } from '@/lib/api/portal';
import {
  useCatalogue,
  useUserChoices,
  useDeviceChoices,
  useCreateServiceRequest,
  useRequestActions,
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

export const useServiceRequestForm = (
  onCreated?: (request: ServiceRequestDetail) => void,
  seed?: LineSeed
) => {
  const [priority, setPriority] = useState<string>('Medium');
  const [lines, setLines] = useState<FormLine[]>([emptyLine(seed)]);
  const actions = useRequestActions();
  const [touched, setTouched] = useState(false);

  const catalogue = useCatalogue();
  const users = useUserChoices();
  const devices = useDeviceChoices();
  const mutation = useCreateServiceRequest();

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
        // asking is allowed either way; saying so up front avoids a surprise at review
        description: item.covered ? undefined : 'Not in your contract yet',
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

  const submit = async () => {
    setTouched(true);
    if (!isValid) return null;

    const created = await mutation.mutateAsync({
      priority,
      lines: lines.flatMap((line) => toPayloadLines(line, deviceServices)),
    });

    reset();
    onCreated?.(created);
    return created;
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
    submitting: mutation.isLoading,
    submitError: mutation.error,
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
      services: serviceOptions,
      users: userOptions,
    },
    deviceServices,
    userFor: (clientUser: string) => usersByName.get(clientUser),
    devicesFor: (clientUser: string) =>
      (devices.data ?? [])
        // a machine that is damaged, returned or in stock is exactly what a request is
        // often about, so every machine they hold is offered, its state shown beside it
        .filter((row) => row.assigned_client_user === clientUser)
        .map((row) => ({
          value: row.name,
          label: row.hostname,
          description:
            [row.status !== 'Active' ? row.status : null, row.device_type, row.serial_number]
              .filter(Boolean)
              .join(' · ') || undefined,
        })),
    deviceFor: (device: string) => (devices.data ?? []).find((row) => row.name === device),
    newDeviceValue: NEW_DEVICE,
    loadingOptions: catalogue.isLoading || users.isLoading || devices.isLoading,
  };
};
