import React, { useState } from 'react';
import { Laptop, Search } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import TruncatedNote from '@/shared/components/TruncatedNote';
import Select from '@/shared/components/Select';
import type { RequestedDeviceValues } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import {
  useResolveRequestedDevice,
  useSaveRequestedDevice,
  useSelectableDevices,
} from '../../hooks/useRequests';
import { useDeviceFilterOptions } from '../../hooks/useDevices';
import { fieldInput, primaryButton, secondaryButton } from '../../lib/workDisplay';
import { PreparationTabs, RequestedInformation, SelectableRow } from './PreparationParts';

type Props = {
  entity: RequestedEntityPresentation;
  customer: string;
  onClose: () => void;
  onSaved: () => void;
};

type Tab = 'existing' | 'new';

const FIELDS: [keyof RequestedDeviceValues, string][] = [
  ['hostname', 'Hostname'],
  ['device_type', 'Device type'],
  ['serial_number', 'Serial number'],
  ['asset_tag', 'Asset tag'],
  ['manufacturer', 'Manufacturer'],
  ['model', 'Model'],
  ['operating_system', 'Operating system'],
];

const TEXT_FIELDS = FIELDS.filter(([key]) => key !== 'device_type');

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const initialValues = (entity: RequestedEntityPresentation): Record<string, string> =>
  Object.fromEntries(
    FIELDS.map(([key]) => [
      key,
      text(entity.prepared_values[key]) || text(entity.requested_snapshot[key]),
    ])
  );

const PrepareRequestedDeviceModal: React.FC<Props> = ({ entity, customer, onClose, onSaved }) => {
  const save = useSaveRequestedDevice();
  const resolve = useResolveRequestedDevice();
  const options = useDeviceFilterOptions();
  const [picked, setPicked] = useState<Tab | null>(null);
  const [opening, setOpening] = useState<Tab | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(entity));
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const candidates = useSelectableDevices(customer, search);
  const named = [entity.requested_snapshot.hostname, entity.requested_snapshot.serial_number]
    .map((value) => text(value).trim().toLowerCase())
    .filter(Boolean);
  const matching = (candidates.data?.rows ?? []).filter(
    (row) =>
      row.selectable &&
      named.some(
        (value) =>
          value === (row.hostname ?? '').trim().toLowerCase() ||
          value === (row.serial_number ?? '').trim().toLowerCase()
      )
  );
  const suggested = matching.length === 1 ? matching[0].name : null;
  const selected = chosen ?? suggested;

  if (opening === null && candidates.data) setOpening(suggested ? 'existing' : 'new');
  const tab: Tab = picked ?? opening ?? 'new';

  const payload = (): RequestedDeviceValues =>
    Object.fromEntries(FIELDS.map(([key]) => [key, values[key]?.trim() || null]));

  const registrable = Boolean(values.hostname?.trim() && values.serial_number?.trim());
  const busy = save.isLoading || resolve.isLoading;
  const error = (resolve.error ?? save.error) as Error | null;
  const deviceTypes = options.data?.device_types ?? [];
  const typeChoices = (
    values.device_type && !deviceTypes.includes(values.device_type)
      ? [values.device_type, ...deviceTypes]
      : deviceTypes
  ).map((type) => ({ value: type, label: type }));

  const set = (key: string, value: string) => {
    setSavedNote(false);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const saveProgress = async () => {
    try {
      await save.mutateAsync({ name: entity.name as string, values: payload() });
      setSavedNote(true);
      onSaved();
    } catch {
      return;
    }
  };

  const saveAndResolve = async () => {
    try {
      if (tab === 'new') {
        await resolve.mutateAsync({ name: entity.name as string, mode: 'new', values: payload() });
      } else {
        await resolve.mutateAsync({
          name: entity.name as string,
          mode: 'existing',
          managed_device: selected as string,
        });
      }
      onSaved();
      onClose();
    } catch {
      return;
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Laptop}
      tone="amber"
      title="Prepare requested Device"
      subtitle="Resolve this requested Device by selecting an existing Device or registering a new one."
      widthClass="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {savedNote && <span className="mr-auto text-xs font-semibold text-emerald-700">Progress saved</span>}
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          {tab === 'new' && (
            <button type="button" onClick={saveProgress} disabled={busy} className={secondaryButton}>
              Save progress
            </button>
          )}
          <button
            type="button"
            onClick={saveAndResolve}
            disabled={busy || (tab === 'new' ? !registrable : !selected)}
            className={primaryButton}
          >
            Save &amp; resolve
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <RequestedInformation
          snapshot={entity.requested_snapshot}
          fields={[['display_label', 'Label'], ...FIELDS]}
        />

        <PreparationTabs<Tab>
          tabs={[
            ['existing', 'Use existing Device'],
            ['new', 'Register new Device'],
          ]}
          value={tab}
          onChange={setPicked}
        />

        {tab === 'existing' ? (
          <div className="space-y-2">
            <label className="block">
              <FieldLabel>Search Devices</FieldLabel>
              <span className="relative block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${fieldInput} pl-9`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Hostname, serial, holder…"
                />
              </span>
            </label>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              {(candidates.data?.rows ?? []).map((row) => (
                <SelectableRow
                  key={row.name}
                  group={`device-${entity.key}`}
                  value={row.name}
                  checked={selected === row.name}
                  selectable={row.selectable}
                  reason={row.unavailable_reason}
                  title={row.hostname ?? row.serial_number ?? row.name}
                  detail={[
                    row.status,
                    row.current_holder
                      ? `Current holder: ${row.current_holder_name ?? row.current_holder}`
                      : 'No current holder',
                    row.serial_number ?? 'No serial',
                  ].join(' · ')}
                  badge={row.status.toUpperCase()}
                  onSelect={() => setChosen(row.name)}
                />
              ))}
              {candidates.data && candidates.data.rows.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches.</p>
              )}
              {candidates.isLoading && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
              )}
            </div>
            <TruncatedNote page={candidates.data} />
            {!chosen && suggested && (
              <p className="text-xs font-medium text-blue-700">
                Pre-selected from what the requester named. You can choose another Device.
              </p>
            )}
            <p className="text-xs text-slate-500">
              Current status and holder are shown for context. Devices are not limited to unassigned stock.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.slice(0, 1).map(([key, label]) => (
              <label key={key} className="block">
                <FieldLabel required>{label}</FieldLabel>
                <input className={fieldInput} value={values[key]} onChange={(event) => set(key, event.target.value)} />
              </label>
            ))}
            <div>
              <FieldLabel>Device type</FieldLabel>
              <Select
                className="w-full"
                value={values.device_type}
                onChange={(value) => set('device_type', value)}
                placeholder="Select a device type"
                options={typeChoices}
              />
            </div>
            {TEXT_FIELDS.slice(1).map(([key, label]) => (
              <label key={key} className="block">
                <FieldLabel required={key === 'serial_number'}>{label}</FieldLabel>
                <input className={fieldInput} value={values[key]} onChange={(event) => set(key, event.target.value)} />
              </label>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default PrepareRequestedDeviceModal;
