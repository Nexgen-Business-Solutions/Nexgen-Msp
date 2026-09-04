import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Laptop, Plus, Trash2, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { CustomerRequestRef, DeviceInterface } from '@/lib/api/internal';
import RequestReferenceField from './RequestReferenceField';
import { useAddDevice } from '../hooks/useUsers';
import {
  useCustomerDevices,
  useHandOverDevice,
  useHostnameMatch,
  useSerialMatch,
} from '../hooks/useDevices';

type Props = {
  open: boolean;
  clientUser: string;
  userName: string;
  customer: string;
  deviceTypes: string[];
  interfaceTypes: string[];
  requests: CustomerRequestRef[];
  defaultRequest?: string;
  /** What the request already says about the machine, so nobody types it twice. */
  initial?: { hostname?: string | null; device_type?: string | null; serial_number?: string | null };
  onClose: () => void;
};

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const AddDeviceModal: React.FC<Props> = ({
  open,
  clientUser,
  userName,
  customer,
  deviceTypes,
  interfaceTypes,
  requests,
  defaultRequest,
  initial,
  onClose,
}) => {
  const navigate = useNavigate();
  const add = useAddDevice(clientUser);
  const handOver = useHandOverDevice();

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState('');
  const [handOverDate, setHandOverDate] = useState(today());
  const [handOverNote, setHandOverNote] = useState('');

  const fleet = useCustomerDevices(open ? customer : null, clientUser);
  const [hostname, setHostname] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [serial, setSerial] = useState('');
  const [assignedDate, setAssignedDate] = useState(today());
  const [sourceRequest, setSourceRequest] = useState('');
  const [interfaces, setInterfaces] = useState<DeviceInterface[]>([
    { interface_type: 'Wi-Fi', mac_address: '' },
    { interface_type: 'LAN', mac_address: '' },
  ]);

  useEffect(() => {
    if (!open) return;
    setMode('new');
    setExisting('');
    setHandOverDate(today());
    setHandOverNote('');
    handOver.reset();
    setHostname(initial?.hostname ?? '');
    setDeviceType(initial?.device_type ?? '');
    setSerial(initial?.serial_number ?? '');
    setAssignedDate(today());
    setSourceRequest(defaultRequest ?? '');
    setInterfaces([
      { interface_type: 'Wi-Fi', mac_address: '' },
      { interface_type: 'LAN', mac_address: '' },
    ]);
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // asked while the name is being typed, so a name already taken is a machine to open
  // rather than a refusal thrown back after the form is filled in
  const clash = useHostnameMatch(open && mode === 'new' ? customer : null, hostname.trim());
  const taken = clash.data?.name ? clash.data : null;

  // the serial number is what identifies the machine, so it is required and cannot be shared
  const serialClash = useSerialMatch(open && mode === 'new' ? serial.trim() : undefined);
  const serialTaken = serialClash.data?.name ? serialClash.data : null;

  const chosen = (fleet.data ?? []).find((item) => item.name === existing) ?? null;

  const openDevice = (name: string) => {
    onClose();
    navigate(`/msp/devices/${name}`);
  };

  const handOverExisting = async () => {
    try {
      await handOver.mutateAsync({
        device: existing,
        client_user: clientUser,
        on_date: handOverDate,
        note: handOverNote.trim() || undefined,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  const update = (position: number, patch: Partial<DeviceInterface>) =>
    setInterfaces((current) =>
      current.map((item, index) => (index === position ? { ...item, ...patch } : item))
    );

  const submit = async () => {
    try {
      await add.mutateAsync({
        client_user: clientUser,
        hostname: hostname.trim(),
        device_type: deviceType || undefined,
        serial_number: serial.trim() || undefined,
        assigned_date: assignedDate || undefined,
        interfaces: interfaces.filter((item) => item.mac_address.trim()),
        source_request: sourceRequest || undefined,
      });

      onClose();
    } catch {
      // surfaced by the mutation error banner above
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Laptop}
      tone="indigo"
      title="Add a device"
      subtitle={
        mode === 'new'
          ? `Register hardware for ${userName}. Services are attached separately, through a request.`
          : `Hand a machine this customer already owns over to ${userName}. Its services follow it.`
      }
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mode === 'new' ? submit : handOverExisting}
            disabled={
              mode === 'new'
                ? !hostname.trim() || !serial.trim() || Boolean(serialTaken) || add.isLoading
                : !existing || !handOverDate || handOver.isLoading
            }
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {add.isLoading || handOver.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : mode === 'new' ? (
              'Add device'
            ) : (
              'Hand it over'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="inline-flex rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
              mode === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            New device
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
              mode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            Existing device
          </button>
        </div>

        {mode === 'existing' && (
          <div className="space-y-4">
            <div>
              <FieldLabel required>Which machine</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={existing}
                onChange={setExisting}
                placeholder={
                  (fleet.data ?? []).length
                    ? 'Search a hostname'
                    : 'This customer has no other device'
                }
                options={(fleet.data ?? []).map((item) => ({
                  value: item.name,
                  label: item.hostname,
                  description: [
                    item.holder_name ? `held by ${item.holder_name}` : 'held by nobody',
                    item.status !== 'Active' ? item.status.toLowerCase() : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            </div>

            {chosen && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{chosen.hostname}</p>
                  <button
                    type="button"
                    onClick={() => openDevice(chosen.name)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
                  >
                    Open its page
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <dt className="text-slate-400">Held by</dt>
                    <dd className="mt-0.5 text-slate-700">
                      {chosen.holder_name ?? 'Nobody'}
                      {chosen.holder_status && chosen.holder_status !== 'Active' && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                          {chosen.holder_status.toUpperCase()}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Since</dt>
                    <dd className="mt-0.5 text-slate-700">{fmtDate(chosen.held_since)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Type</dt>
                    <dd className="mt-0.5 text-slate-700">{chosen.device_type ?? 'N/A'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Status</dt>
                    <dd className="mt-0.5 text-slate-700">{chosen.status}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Serial number</dt>
                    <dd className="mt-0.5 text-slate-700">{chosen.serial_number ?? 'N/A'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Open services</dt>
                    <dd className="mt-0.5 text-slate-700">
                      {chosen.open_services} — they follow the machine
                    </dd>
                  </div>
                  {chosen.interfaces.length > 0 && (
                    <div className="col-span-2">
                      <dt className="text-slate-400">MAC</dt>
                      <dd className="mt-0.5 font-mono text-slate-700">
                        {chosen.interfaces.map((row) => row.mac_address).join(' · ')}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <div>
              <FieldLabel required>Hand-over date</FieldLabel>
              <input
                type="date"
                value={handOverDate}
                max={today()}
                onChange={(event) => setHandOverDate(event.target.value)}
                className={inputClass}
              />
              <p className="mt-1.5 text-xs text-slate-400">
                Today by default. Set it back if it changed hands earlier.
              </p>
            </div>

            <div>
              <span className={labelClass}>Internal note</span>
              <textarea
                rows={2}
                value={handOverNote}
                onChange={(event) => setHandOverNote(event.target.value)}
                placeholder="Why it changed hands — kept for Nexgen, not shown to the customer."
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {handOver.error instanceof Error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
                <span className="text-sm font-medium text-red-700">{handOver.error.message}</span>
              </div>
            )}
          </div>
        )}

        {mode === 'new' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Hostname</FieldLabel>
            <input
              type="text"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="SN-HYS-JDUPONT"
              className={`${inputClass} uppercase`}
            />
            {taken && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">{taken.hostname}</span> is already taken —{' '}
                  {taken.same_customer
                    ? taken.holder_name
                      ? `held by ${taken.holder_name} since ${fmtDate(taken.held_since)}`
                      : 'held by nobody'
                    : `it belongs to ${taken.customer}`}
                  {taken.status !== 'Active' ? ` · ${taken.status.toLowerCase()}` : ''}. You may
                  still register another machine under that name — what has to be unique is the
                  serial number.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openDevice(taken.name)}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                  >
                    Open it
                    <ArrowUpRight size={13} />
                  </button>
                  {taken.same_customer && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('existing');
                        setExisting(taken.name);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      <TriangleAlert size={13} />
                      Pick it and hand it to {userName}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div>
            <span className={labelClass}>Device type</span>
            <Select
              className="w-full"
              value={deviceType}
              onChange={setDeviceType}
              placeholder="Select a type"
              options={deviceTypes.map((type) => ({ value: type, label: type }))}
            />
          </div>
          <div>
            <FieldLabel required>Serial number</FieldLabel>
            <input
              type="text"
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              placeholder="What is engraved on the case"
              className={inputClass}
            />
            {serialTaken && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                <p className="text-xs text-red-700">
                  This serial number is already on{' '}
                  <span className="font-semibold">{serialTaken.hostname}</span> (
                  {serialTaken.customer}
                  {serialTaken.holder_name ? `, held by ${serialTaken.holder_name}` : ''}). Two
                  records cannot share it.
                </p>
                <button
                  type="button"
                  onClick={() => openDevice(serialTaken.name)}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
                >
                  Open it
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </div>
          <div>
            <span className={labelClass}>In service since</span>
            <input
              type="date"
              value={assignedDate}
              onChange={(event) => setAssignedDate(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        )}

        {mode === 'new' && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Network interfaces</span>
            <button
              type="button"
              onClick={() =>
                setInterfaces((current) => [
                  ...current,
                  { interface_type: 'Extra', mac_address: '' },
                ])
              }
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
            >
              <Plus size={13} />
              Add another
            </button>
          </div>

          <div className="space-y-2">
            {interfaces.map((item, position) => (
              <div key={position} className="flex items-center gap-2">
                <Select
                  className="w-36 shrink-0"
                  value={item.interface_type}
                  onChange={(value) => update(position, { interface_type: value })}
                  options={interfaceTypes.map((type) => ({
                    value: type,
                    label: INTERFACE_LABEL[type] ?? type,
                  }))}
                />
                <input
                  type="text"
                  value={item.mac_address}
                  onChange={(event) => update(position, { mac_address: event.target.value })}
                  placeholder="AA-BB-CC-DD-EE-FF"
                  className={`${inputClass} font-mono uppercase`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setInterfaces((current) => current.filter((_, index) => index !== position))
                  }
                  aria-label="Remove interface"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

        </div>
        )}

        {mode === 'new' && (
          <RequestReferenceField
            requests={requests}
            value={sourceRequest}
            onChange={setSourceRequest}
          />
        )}

        {mode === 'new' && add.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{add.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AddDeviceModal;
