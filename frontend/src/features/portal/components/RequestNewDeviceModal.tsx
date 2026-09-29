import React, { useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import TruncatedNote from '@/shared/components/TruncatedNote';
import type { RequestedDeviceDraft, SelectableClientUser } from '@/lib/api/portal';
import { useSelectableClientUsers } from '../hooks/usePortal';
import { deviceKeyOf, deviceLabelOf, type HolderPerson } from '../hooks/useRequestBuilder';

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const FIELDS = [
  ['hostname', 'Hostname'],
  ['serial_number', 'Serial number'],
  ['manufacturer', 'Manufacturer'],
  ['model', 'Model'],
  ['operating_system', 'Operating system'],
] as const;

type Field = (typeof FIELDS)[number][0];

const RequestNewDeviceModal: React.FC<{
  deviceTypes: string[];
  futurePeople: { key: string; fullName: string }[];
  holder?: string;
  onClose: () => void;
  onAdd: (device: RequestedDeviceDraft, holder: HolderPerson | null) => void;
}> = ({ deviceTypes, futurePeople, holder: initialHolder = '', onClose, onAdd }) => {
  const [query, setQuery] = useState('');
  const people = useSelectableClientUsers(query);
  const [deviceType, setDeviceType] = useState('');
  const [values, setValues] = useState<Record<Field, string>>({
    hostname: '',
    serial_number: '',
    manufacturer: '',
    model: '',
    operating_system: '',
  });
  const [holder, setHolder] = useState(initialHolder);

  const [picked, setPicked] = useState<SelectableClientUser | null>(null);
  const needle = query.trim().toLowerCase();
  const found = (people.data?.rows ?? []).filter((person) => person.selectable);
  const existing =
    picked && !found.some((person) => person.name === picked.name) ? [picked, ...found] : found;
  const holderOptions = [
    { value: '', label: 'Nobody yet' },
    ...futurePeople
      .filter((person) => !needle || person.fullName.toLowerCase().includes(needle) || holder === `subject:${person.key}`)
      .map((person) => ({
      value: `subject:${person.key}`,
      label: person.fullName || 'New person',
      description: 'New person in this request',
    })),
    ...existing.map((person) => ({
      value: `cu:${person.name}`,
      label: person.full_name,
      description: person.department ?? undefined,
    })),
  ];

  const add = () => {
    const clean = (value: string) => value.trim() || null;
    const draft: RequestedDeviceDraft = {
      device_requirement_key: deviceKeyOf(),
      requested_device: null,
      display_label: '',
      device_type: deviceType || null,
      hostname: clean(values.hostname),
      serial_number: clean(values.serial_number),
      asset_tag: null,
      manufacturer: clean(values.manufacturer),
      model: clean(values.model),
      operating_system: clean(values.operating_system),
      intended_holder_client_user: holder.startsWith('cu:') ? holder.slice(3) : null,
      intended_holder_subject_key: holder.startsWith('subject:') ? holder.slice(8) : null,
    };
    draft.display_label = deviceLabelOf(draft);
    const person = holder.startsWith('cu:')
      ? existing.find((row) => row.name === holder.slice(3))
      : undefined;

    onAdd(draft, person ?? null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={MonitorSmartphone}
      title="New device"
      subtitle="Fill what you have. Nexgen can complete the missing information during fulfilment."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Add device
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Device type</FieldLabel>
          {deviceTypes.length ? (
            <Select
              className="w-full"
              value={deviceType}
              onChange={setDeviceType}
              placeholder="Not known yet"
              options={[
               
                ...deviceTypes.map((type) => ({ value: type, label: type })),
              ]}
            />
          ) : (
            <input
              value={deviceType}
              aria-label="Device type"
              onChange={(event) => setDeviceType(event.target.value)}
              className={inputClass}
            />
          )}
        </div>

        {FIELDS.map(([field, label]) => (
          <div key={field}>
            <FieldLabel>{label}</FieldLabel>
            <input
              value={values[field]}
              aria-label={label}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field]: event.target.value }))
              }
              className={inputClass}
            />
          </div>
        ))}

        <div className="sm:col-span-2">
          <FieldLabel>Intended holder</FieldLabel>
          <Select
            searchable
            className="w-full"
            value={holder}
            onChange={(next) => {
              setHolder(next);
              setPicked(existing.find((person) => `cu:${person.name}` === next) ?? null);
            }}
            onSearch={setQuery}
            footnote={<TruncatedNote page={people.data} />}
            placeholder="Nobody yet"
            options={holderOptions}
          />
        </div>
      </div>
    </Modal>
  );
};

export default RequestNewDeviceModal;
