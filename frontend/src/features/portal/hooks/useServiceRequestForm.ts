import { useMemo, useState } from 'react';
import type { NewRequestLine, ServiceRequestDetail } from '@/lib/api/portal';
import {
  useCatalogue,
  useClientUsers,
  useCreateServiceRequest,
  useDevices,
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
  services: string[];
  managed_device: string;
  new_device_label: string;
  requested_effective_date: string;
  comment: string;
};

export type LineErrors = Partial<Record<keyof FormLine, string>>;

const today = () => new Date().toISOString().slice(0, 10);

let lineCounter = 0;

const emptyLine = (): FormLine => {
  lineCounter += 1;
  return {
    key: `line-${lineCounter}`,
    action: '',
    isNewUser: false,
    client_user: '',
    new_user_full_name: '',
    new_user_department: '',
    services: [],
    managed_device: '',
    new_device_label: '',
    requested_effective_date: today(),
    comment: '',
  };
};

export const NEW_DEVICE = '__new_device__';

const validateLine = (line: FormLine, deviceServices: Set<string>): LineErrors => {
  const errors: LineErrors = {};

  if (line.isNewUser) {
    if (!line.new_user_full_name.trim()) errors.new_user_full_name = 'Enter the full name.';
  } else if (!line.client_user) {
    errors.client_user = 'Select a user.';
  }

  if (!line.action) errors.action = 'Select an action.';
  if (!line.services.length) errors.services = 'Select at least one service.';

  const needsDevice = line.services.some((service) => deviceServices.has(service));

  if (needsDevice) {
    if (!line.managed_device) errors.managed_device = 'Pick the device, or ask us to register one.';
    else if (line.managed_device === NEW_DEVICE && !line.new_device_label.trim())
      errors.new_device_label = 'Describe the device to register.';
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
      client_user: line.isNewUser || onDevice ? undefined : line.client_user,
      managed_device: onDevice ? line.managed_device : undefined,
      new_user_full_name: line.isNewUser ? line.new_user_full_name.trim() : undefined,
      new_user_department: line.isNewUser
        ? line.new_user_department.trim() || undefined
        : undefined,
      requested_service: service,
      requested_effective_date: line.requested_effective_date || undefined,
      comment: line.comment || undefined,
    };
  });

export const useServiceRequestForm = (onCreated?: (request: ServiceRequestDetail) => void) => {
  const [priority, setPriority] = useState<string>('Medium');
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const actions = useRequestActions();
  const [touched, setTouched] = useState(false);

  const catalogue = useCatalogue();
  const users = useClientUsers(200);
  const devices = useDevices(200);
  const mutation = useCreateServiceRequest();

  const deviceServices = useMemo(
    () =>
      new Set(
        (catalogue.data?.items ?? [])
          .filter((item) => item.scope === 'Device')
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
      (users.data?.rows ?? []).map((row) => ({
        value: row.name,
        label: row.full_name,
      })),
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
    devicesFor: (clientUser: string) =>
      (devices.data?.rows ?? [])
        .filter((row) => row.assigned_client_user === clientUser && row.status === 'Active')
        .map((row) => ({
          value: row.name,
          label: [row.device_type, row.assigned_user_name].filter(Boolean).join(' · '),
          description: row.hostname,
        })),
    newDeviceValue: NEW_DEVICE,
    loadingOptions: catalogue.isLoading || users.isLoading || devices.isLoading,
  };
};
