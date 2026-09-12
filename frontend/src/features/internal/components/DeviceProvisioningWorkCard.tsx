import React, { useMemo, useState } from 'react';
import { Laptop, Search } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useCustomerDevices, useDeviceFilterOptions } from '../hooks/useDevices';
import { useExecuteDeviceProvisioning } from '../hooks/useRequests';
import WorkCardShell from './WorkCardShell';

const inputClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500';

type Props = {
  card: WorkCard;
  customer: string;
  person: SubjectWorkGroup['person'];
  needs: string[];
};

/** Settling the machine, in the request: one off the shelf, or a new one put on file. */
const DeviceProvisioningWorkCard: React.FC<Props> = ({ card, customer, person, needs }) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [hostname, setHostname] = useState(card.asked_hostname ?? '');
  const [serial, setSerial] = useState(card.asked_serial ?? '');
  const [deviceType, setDeviceType] = useState(card.asked_device_type ?? '');

  const options = useDeviceFilterOptions();
  const devices = useCustomerDevices(customer);
  const provision = useExecuteDeviceProvisioning();

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = devices.data ?? [];

    if (!needle) return rows.slice(0, 6);

    return rows
      .filter((row) =>
        [row.hostname, row.serial_number, row.device_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      )
      .slice(0, 6);
  }, [devices.data, search]);

  const chosen = (devices.data ?? []).find((row) => row.name === picked);
  const heldByAnother = Boolean(
    chosen?.assigned_client_user && chosen.assigned_client_user !== person?.name
  );

  const settled = card.status === 'Completed';

  return (
    <WorkCardShell
      card={card}
      title={settled ? card.device?.hostname || 'Device' : 'Device required'}
      subtitle={
        settled ? (
          <>
            {card.device?.serial_number ? `Serial ${card.device.serial_number}` : 'No serial'}
            {card.device?.device_type ? ` · ${card.device.device_type}` : ''}
            {card.device?.holder_name ? ` · held by ${card.device.holder_name}` : ''}
          </>
        ) : (
          <>
            For {person?.full_name ?? 'this person'}
            {needs.length ? ` · required for ${needs.join(', ')}` : ''}
          </>
        )
      }
    >
      <div className="mt-3 flex flex-wrap gap-2">
        {(['existing', 'new'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === option
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option === 'existing' ? 'Use an existing device' : 'Register a new device'}
          </button>
        ))}
      </div>

      {mode === 'existing' ? (
        <div className="mt-3">
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

          <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
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
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Laptop size={13} className="text-slate-400" />
                  {row.hostname}
                </span>
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

          <button
            type="button"
            disabled={!picked || provision.isLoading}
            onClick={() =>
              provision.mutate({
                work_order: card.name,
                mode: 'existing',
                managed_device: picked as string,
                confirm_transfer: heldByAnother ? 1 : undefined,
              })
            }
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {heldByAnother ? `Transfer to ${person?.full_name}` : 'Assign this device'}
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel required>Hostname</FieldLabel>
              <input
                className={inputClass}
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="LAPTOP-MDUPONT"
              />
            </div>
            <div>
              <FieldLabel required>Serial number</FieldLabel>
              <input
                className={inputClass}
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
                placeholder="DELL-938828"
              />
            </div>
            <div>
              <FieldLabel>Device type</FieldLabel>
              <Select
                className="w-full"
                value={deviceType}
                onChange={setDeviceType}
                placeholder="Select"
                options={(options.data?.device_types ?? []).map((type) => ({
                  value: type,
                  label: type,
                }))}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!hostname.trim() || !serial.trim() || provision.isLoading}
            onClick={() =>
              provision.mutate({
                work_order: card.name,
                mode: 'new',
                hostname: hostname.trim(),
                serial_number: serial.trim(),
                device_type: deviceType || undefined,
              })
            }
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Register and assign
          </button>
        </div>
      )}

      {provision.error instanceof Error && (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {provision.error.message}
        </p>
      )}
    </WorkCardShell>
  );
};

export default DeviceProvisioningWorkCard;
