import React, { useEffect, useMemo, useState } from 'react';
import { Laptop, Search } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useCustomerDevices, useDeviceFilterOptions } from '../../hooks/useDevices';
import { useExecuteDeviceProvisioning } from '../../hooks/useRequests';
import { inputClass } from '../../lib/fulfilmentStyles';

type Props = {
  card: WorkCard | null;
  customer: string;
  person: SubjectWorkGroup['person'];
  needs: string[];
  onClose: () => void;
};

/** The machine the device work waits on: taken from stock, or registered, then handed over. */
const DeviceModal: React.FC<Props> = ({ card, customer, person, needs, onClose }) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [hostname, setHostname] = useState('');
  const [serial, setSerial] = useState('');
  const [deviceType, setDeviceType] = useState('');

  const options = useDeviceFilterOptions();
  const devices = useCustomerDevices(card ? customer : null);
  const provision = useExecuteDeviceProvisioning();

  useEffect(() => {
    if (!card) return;
    setMode('existing');
    setSearch('');
    setPicked(null);
    setHostname(card.asked_hostname ?? '');
    setSerial(card.asked_serial ?? '');
    setDeviceType(card.asked_device_type ?? '');
    provision.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = devices.data ?? [];

    if (!needle) return rows.slice(0, 8);

    return rows
      .filter((row) =>
        [row.hostname, row.serial_number, row.device_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      )
      .slice(0, 8);
  }, [devices.data, search]);

  const chosen = (devices.data ?? []).find((row) => row.name === picked);
  const heldByAnother = Boolean(
    chosen?.assigned_client_user && chosen.assigned_client_user !== person?.name
  );

  const canSubmit =
    mode === 'existing' ? Boolean(picked) : Boolean(hostname.trim() && serial.trim());

  const submit = async () => {
    if (!card || !canSubmit) return;
    try {
      await provision.mutateAsync(
        mode === 'existing'
          ? {
              work_order: card.name,
              mode: 'existing',
              managed_device: picked as string,
              confirm_transfer: heldByAnother ? 1 : undefined,
            }
          : {
              work_order: card.name,
              mode: 'new',
              hostname: hostname.trim(),
              serial_number: serial.trim(),
              device_type: deviceType || undefined,
            }
      );
      onClose();
    } catch {
      // shown below
    }
  };

  return (
    <Modal
      open={Boolean(card)}
      onClose={onClose}
      icon={Laptop}
      tone="emerald"
      title="Prepare Device"
      subtitle={`For ${person?.full_name ?? 'this person'}${needs.length ? ` · needed by ${needs.join(', ')}` : ''}`}
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || provision.isLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {mode === 'existing'
              ? heldByAnother
                ? `Transfer to ${person?.full_name ?? 'them'}`
                : 'Assign Device'
              : 'Register & assign'}
          </button>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ['existing', 'Use existing stock Device', 'Select and assign an available Device.'],
            ['new', 'Register new Device', 'Create the Device, then assign it.'],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
              mode === value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-sm font-semibold text-slate-900">{label}</span>
            <span className="block text-xs text-slate-500">{hint}</span>
          </button>
        ))}
      </div>

      {mode === 'existing' ? (
        <div className="mt-4">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className={`${inputClass} pl-9`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by hostname or serial"
              aria-label="Search by hostname or serial"
            />
          </div>
          <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {matches.length === 0 && (
              <p className="px-3 py-3 text-xs text-slate-500">No machine matches that.</p>
            )}
            {matches.map((row) => (
              <button
                key={row.name}
                type="button"
                onClick={() => setPicked(row.name)}
                className={`flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left transition-colors ${
                  picked === row.name ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-semibold text-slate-900">{row.hostname}</span>
                <span className="text-xs text-slate-500">
                  {[row.serial_number || 'no serial', row.holder_name || row.status]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
          {heldByAnother && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {chosen?.hostname} is currently held by {chosen?.holder_name}. Transferring it closes
              their holding period.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Hostname</FieldLabel>
            <input
              className={inputClass}
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              aria-label="Hostname"
            />
          </div>
          <div>
            <FieldLabel required>Serial number</FieldLabel>
            <input
              className={inputClass}
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              aria-label="Serial number"
            />
          </div>
          <div>
            <FieldLabel>Device type</FieldLabel>
            <Select
              className="w-full"
              value={deviceType}
              onChange={setDeviceType}
              placeholder="Select"
              options={(options.data?.device_types ?? []).map((type) => ({ value: type, label: type }))}
            />
          </div>
          <div>
            <FieldLabel>Holder</FieldLabel>
            <input className={`${inputClass} bg-slate-50`} readOnly value={person?.full_name ?? ''} />
          </div>
        </div>
      )}

      {provision.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {provision.error.message}
        </p>
      )}
    </Modal>
  );
};

export default DeviceModal;
