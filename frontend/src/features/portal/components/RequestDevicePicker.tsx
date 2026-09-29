import React, { useState } from 'react';
import { Laptop } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Modal from '@/shared/components/Modal';
import TruncatedNote from '@/shared/components/TruncatedNote';
import type { SelectableDevice } from '@/lib/api/portal';
import { useSelectableDevices } from '../hooks/usePortal';
import { takenReason } from '../machinesTaken';

export const DEVICE_CHOICE_HELPER =
  'Current status and holder are shown for context. Devices are not limited to unassigned stock.';

const RequestDevicePicker: React.FC<{
  title?: string;
  taken?: Map<string, string>;
  onClose: () => void;
  onPick: (device: SelectableDevice) => void;
}> = ({ title = 'Choose a Device', taken, onClose, onPick }) => {
  const [search, setSearch] = useState('');
  const devices = useSelectableDevices(search || undefined);
  const rows = devices.data?.rows ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      icon={Laptop}
      title={title}
      subtitle="Every Device of this customer."
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel>Search</FieldLabel>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search devices"
            placeholder="Hostname, serial number or holder"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {['Device', 'Serial number', 'Status', 'Current holder', ''].map((label) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((device) => {
                const label = device.hostname || device.name;
                const asked = taken?.has(device.name) ?? false;
                const open = device.selectable && !asked;
                const reason = asked
                  ? takenReason(taken?.get(device.name) ?? '')
                  : device.unavailable_reason;

                return (
                  <tr
                    key={device.name}
                    data-device={device.name}
                    aria-disabled={!open || undefined}
                    title={open ? undefined : (reason ?? undefined)}
                    className={open ? '' : 'bg-slate-50/70 text-slate-400'}
                  >
                    <td className="px-3 py-2">
                      <p
                        className={`text-sm font-semibold ${
                          open ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {label}
                      </p>
                      {!open && reason && <p className="text-[11px] text-slate-400">{reason}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs">{device.serial_number || '—'}</td>
                    <td className="px-3 py-2 text-xs">{device.status}</td>
                    <td className="px-3 py-2 text-xs">
                      {device.current_holder_name || device.current_holder || 'In stock'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={!open}
                        aria-label={`Choose ${label}`}
                        onClick={() => onPick(device)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Choose
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!devices.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    No result.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TruncatedNote page={devices.data} />

        <p className="text-[11px] text-slate-500">{DEVICE_CHOICE_HELPER}</p>
      </div>
    </Modal>
  );
};

export default RequestDevicePicker;
