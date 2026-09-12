import React from 'react';
import { ArrowUpRight, Laptop, Plus } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import type { HeldDevice, ServiceOffer, UserServiceEntry } from '@/lib/api/internal';
import UserServiceList from './UserServiceList';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'Wi-Fi',
  LAN: 'LAN',
  Extra: 'Extra',
  Other: 'Other',
};

type Props = {
  slot: HeldDevice;
  onAsk: (service: UserServiceEntry, action: string) => void;
  onAdd: (offer: ServiceOffer) => void;
  onApply: (service: UserServiceEntry, action: string) => void;
  onAddService: () => void;
  onOpenRequest: (request: string) => void;
  onOpenDevice: (device: string) => void;
};

/**
 * One machine they hold today, with what runs on it.
 *
 * The hostname, the type, the serial and the day they were given it are read together: a
 * serial buried in a column is a serial nobody finds when the vendor asks for it.
 */
const HeldDeviceCard: React.FC<Props> = ({
  slot,
  onAsk,
  onAdd,
  onApply,
  onAddService,
  onOpenRequest,
  onOpenDevice,
}) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Laptop size={15} className="text-slate-400" />
          {slot.device.hostname}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {slot.device.device_type || 'Unknown type'} ·{' '}
          {slot.device.serial_number ? (
            <span className="font-mono">Serial {slot.device.serial_number}</span>
          ) : (
            <span className="font-semibold text-amber-700">no serial number</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">Held since {fmtDate(slot.holder_since)}</p>
        {slot.device.in_service_since && (
          <p className="text-xs text-slate-400">
            In service since {fmtDate(slot.device.in_service_since)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge value={slot.device.status} />
        <button
          type="button"
          onClick={() => onOpenDevice(slot.device.name)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800"
        >
          Full device record
          <ArrowUpRight size={12} />
        </button>
      </div>
    </header>

    {slot.interfaces.length > 0 && (
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2">
        {slot.interfaces.map((row) => (
          <span key={`${row.interface_type}-${row.mac_address}`} className="text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wide text-slate-400">
              {INTERFACE_LABEL[row.interface_type] ?? row.interface_type}
            </span>{' '}
            <span className="font-mono">{row.mac_address}</span>
          </span>
        ))}
      </div>
    )}

    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Device services
        </p>
        <button
          type="button"
          onClick={onAddService}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Plus size={12} />
          Add service
        </button>
      </div>
      <UserServiceList
        services={slot.services.current}
        available={slot.services.available}
        emptyMessage="Nothing is running on this machine."
        onAsk={onAsk}
        onAdd={onAdd}
        onApply={onApply}
        onOpenRequest={onOpenRequest}
      />
    </div>
  </section>
);

export default HeldDeviceCard;
