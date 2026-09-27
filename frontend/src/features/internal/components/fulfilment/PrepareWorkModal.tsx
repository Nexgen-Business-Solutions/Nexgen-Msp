import React, { useState } from 'react';
import { ChevronDown, HardDrive, UserPlus } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import FieldLabel from '@/shared/components/FieldLabel';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import type { WorkRequirement } from '@/lib/api/internal';
import { useDeviceChoices } from '@/features/portal/hooks/usePortal';
import { useDepartmentOptions } from '../../hooks/useSettings';
import { useExecuteWorkOrders } from '../../hooks/useRequests';

const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';
const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

type Row = Record<string, string>;
type Status = 'setup' | 'ready' | 'saved' | 'error';

const STATE: Record<Status, { label: string; tone: string }> = {
  setup: { label: 'Needs setup', tone: 'bg-amber-50 text-amber-800' },
  ready: { label: 'Ready', tone: 'bg-blue-50 text-blue-700' },
  saved: { label: 'Saved', tone: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Error', tone: 'bg-red-50 text-red-700' },
};

const COPY = {
  device_resolution: {
    title: 'Prepare required Devices',
    subtitle:
      'Configure the Devices needed by this request. Completed rows are saved immediately, so you can return later.',
    icon: HardDrive,
  },
  client_user_creation: {
    title: 'Create requested Client Users',
    subtitle:
      'Create the people needed by this request. Only the full name was required from the customer; complete additional information when available.',
    icon: UserPlus,
  },
} as const;

/**
 * The preparation a request needs before its real work can run, done row by row.
 *
 * Each row goes through the lifecycle service that owns the thing being prepared, on its own
 * and committed on its own: a machine that could not be settled leaves the ones already
 * prepared exactly as they are, and the dialog stays open for what is left.
 */
const PrepareWorkModal: React.FC<{
  request: string;
  customer: string;
  kind: 'device_resolution' | 'client_user_creation';
  requirements: WorkRequirement[];
  onClose: () => void;
}> = ({ request, customer, kind, requirements, onClose }) => {
  const run = useExecuteWorkOrders();
  const devices = useDeviceChoices();
  // a Department that belongs to one company is only offered to that company
  const departments = useDepartmentOptions(customer);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [states, setStates] = useState<Record<string, Status>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const copy = COPY[kind];
  /**
   * The rows this dialog opened with.
   *
   * A row that is saved leaves the plan, so counting the live list would shrink the total
   * under the person reading it. What was asked of them when they opened the dialog is what
   * the dialog goes on saying.
   */
  const [mine] = useState(() => requirements.filter((row) => row.kind === kind && !row.satisfied));
  const dirty = Object.entries(rows).filter(([key, row]) =>
    kind === 'device_resolution'
      ? row.mode === 'existing'
        ? Boolean(row.managed_device)
        : Boolean(row.hostname?.trim())
      : states[key] !== 'saved'
  );

  const patch = (key: string, values: Row) =>
    setRows((current) => ({ ...current, [key]: { ...(current[key] ?? {}), ...values } }));

  const commit = async (requirement: WorkRequirement) => {
    const key = requirement.key;
    const row = rows[key] ?? {};

    setFailures((current) => ({ ...current, [key]: '' }));

    const inputs =
      kind === 'device_resolution'
        ? row.mode === 'existing'
          ? {
              mode: 'existing',
              managed_device: row.managed_device,
              confirm_transfer: 1,
            }
          : {
              mode: 'new',
              hostname: row.hostname?.trim(),
              device_type: row.device_type || undefined,
              serial_number: row.serial_number?.trim() || undefined,
              manufacturer: row.manufacturer?.trim() || undefined,
              model: row.model?.trim() || undefined,
              operating_system: row.operating_system?.trim() || undefined,
            }
        : {
            username: (row.username ?? requirement.owner_username)?.trim() || undefined,
            email: (row.email ?? requirement.owner_email)?.trim() || undefined,
            department: row.department || requirement.owner_department || undefined,
          };

    const outcome = await run.mutateAsync({
      request,
      executions: [{ work_order: requirement.work_order as string, inputs }],
    });
    const result = outcome.results[0];

    if (result?.ok) {
      setStates((current) => ({ ...current, [key]: 'saved' }));
      setRows((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } else {
      setStates((current) => ({ ...current, [key]: 'error' }));
      setFailures((current) => ({
        ...current,
        [key]: result?.message ?? 'Could not be saved.',
      }));
    }
  };

  const done = Object.values(states).filter((state) => state === 'saved').length;

  return (
    <>
      <Modal
        open
        onClose={() => (dirty.length ? setLeaving(true) : onClose())}
        icon={copy.icon}
        title={copy.title}
        subtitle={copy.subtitle}
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span role="status" className="text-xs text-slate-500">
              {done} of {mine.length} completed
            </span>
            <button
              type="button"
              onClick={() => (dirty.length ? setLeaving(true) : onClose())}
              className={quietBtn}
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          {mine.map((requirement) => {
            const key = requirement.key;
            const row = rows[key] ?? {};
            const state = states[key] ?? 'setup';
            const expanded = open === key;

            return (
              <div key={key} className="overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                  className="flex w-full items-center justify-between gap-3 bg-slate-50/70 px-4 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {requirement.owner_label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {requirement.reason}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE[state].tone}`}
                    >
                      {STATE[state].label}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {expanded && state !== 'saved' && (
                  <div className="space-y-3 px-4 py-3">
                    {kind === 'device_resolution' && (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {(['existing', 'new'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={(row.mode ?? 'existing') === mode}
                              onClick={() => patch(key, { mode })}
                              className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                                (row.mode ?? 'existing') === mode
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {mode === 'existing' ? 'Use existing Device' : 'Register new Device'}
                            </button>
                          ))}
                        </div>

                        {(row.mode ?? 'existing') === 'existing' ? (
                          <div>
                            <FieldLabel required>Device</FieldLabel>
                            <Select
                              searchable
                              className="w-full"
                              value={row.managed_device ?? ''}
                              onChange={(value) => patch(key, { managed_device: value })}
                              placeholder="Choose a Device"
                              options={(devices.data ?? []).map((device) => ({
                                value: device.name,
                                label: device.hostname || device.serial_number || device.name,
                                // a machine somebody holds is transferred when this is saved
                                description: [
                                  device.status,
                                  device.assigned_user_name
                                    ? `held by ${device.assigned_user_name}`
                                    : 'in stock',
                                ]
                                  .filter(Boolean)
                                  .join(' · '),
                              }))}
                            />
                          </div>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <FieldLabel required>Hostname</FieldLabel>
                              <input
                                value={row.hostname ?? ''}
                                aria-label={`Hostname for ${requirement.owner_label}`}
                                onChange={(event) => patch(key, { hostname: event.target.value })}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <FieldLabel>Device type</FieldLabel>
                              <input
                                value={row.device_type ?? ''}
                                aria-label={`Device type for ${requirement.owner_label}`}
                                onChange={(event) =>
                                  patch(key, { device_type: event.target.value })
                                }
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <FieldLabel>Serial number</FieldLabel>
                              <input
                                value={row.serial_number ?? ''}
                                aria-label={`Serial number for ${requirement.owner_label}`}
                                onChange={(event) =>
                                  patch(key, { serial_number: event.target.value })
                                }
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <FieldLabel>Manufacturer</FieldLabel>
                              <input
                                value={row.manufacturer ?? ''}
                                aria-label={`Manufacturer for ${requirement.owner_label}`}
                                onChange={(event) =>
                                  patch(key, { manufacturer: event.target.value })
                                }
                                className={inputClass}
                              />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {kind === 'client_user_creation' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel>Full name</FieldLabel>
                          <input
                            readOnly
                            value={requirement.owner_label ?? ''}
                            aria-label={`Full name for ${requirement.owner_label}`}
                            className={`${inputClass} bg-slate-50 text-slate-500`}
                          />
                        </div>
                        <div>
                          {/* the customer is never asked for one; the person still needs one */}
                          <FieldLabel required>Department</FieldLabel>
                          <Select
                            searchable
                            className="w-full"
                            value={row.department ?? requirement.owner_department ?? ''}
                            onChange={(value) => patch(key, { department: value })}
                            placeholder="Choose a Department"
                            options={departments.data ?? []}
                          />
                        </div>
                        <div>
                          <FieldLabel>Email</FieldLabel>
                          <input
                            value={row.email ?? requirement.owner_email ?? ''}
                            aria-label={`Email for ${requirement.owner_label}`}
                            onChange={(event) => patch(key, { email: event.target.value })}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <FieldLabel>Username</FieldLabel>
                          <input
                            value={row.username ?? requirement.owner_username ?? ''}
                            aria-label={`Username for ${requirement.owner_label}`}
                            onChange={(event) => patch(key, { username: event.target.value })}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    )}

                    {failures[key] && (
                      <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                        {failures[key]}
                      </p>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={
                          run.isLoading ||
                          (kind === 'client_user_creation' &&
                            !(row.department ?? requirement.owner_department))
                        }
                        onClick={() => commit(requirement)}
                        className={primaryBtn}
                      >
                        {kind === 'device_resolution' ? 'Save this Device' : 'Create this person'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {mine.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              Nothing left to prepare here.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={leaving}
        title="Discard unsaved changes?"
        description="Values that were already saved will be kept. Unsaved fields in this dialog will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          onClose();
        }}
      />
    </>
  );
};

export default PrepareWorkModal;
