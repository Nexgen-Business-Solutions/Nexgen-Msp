import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Laptop, Layers, Plus, Trash2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { DeviceInterface, UserDetail } from '@/lib/api/internal';
import RequestReferenceField from './RequestReferenceField';
import { useAssignService } from '../hooks/useUsers';

type Props = {
  open: boolean;
  detail: UserDetail;
  defaultRequest?: string;
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

const AssignServiceModal: React.FC<Props> = ({ open, detail, defaultRequest, onClose }) => {
  const assign = useAssignService(detail.user.name);

  const [service, setService] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceRequest, setSourceRequest] = useState('');
  const [targetScope, setTargetScope] = useState<'User' | 'Device'>('User');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [device, setDevice] = useState('');
  const [hostname, setHostname] = useState('');
  const [serial, setSerial] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [username, setUsername] = useState('');
  const [interfaces, setInterfaces] = useState<DeviceInterface[]>([]);

  const activeDevices = useMemo(
    () => detail.devices.filter((item) => item.status === 'Active'),
    [detail.devices]
  );

  useEffect(() => {
    if (!open) return;
    setService('');
    setEffectiveDate(today());
    setNotes('');
    setSourceRequest(defaultRequest ?? '');
    setTargetScope('User');
    setMode(activeDevices.length ? 'existing' : 'new');
    setDevice(activeDevices[0]?.name ?? '');
    setHostname('');
    setSerial('');
    setUsername('');
    setDeviceType('');
    setInterfaces([]);
    assign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openServices = new Set(
    detail.services
      .filter((row) => !['Ended', 'Cancelled'].includes(row.operational_status))
      .map((row) => row.service_item)
  );

  const available = detail.catalogue.filter((item) => !openServices.has(item.name));

  const declaredScope = detail.catalogue.find((item) => item.name === service)?.scope;
  const canChooseScope = declaredScope === 'Both';
  const requiresDevice = declaredScope === 'Device' || (canChooseScope && targetScope === 'Device');

  // the two facts the request cannot be closed without: asked for here, where the machine
  // and the licence are still in front of whoever is doing the work
  const chosenDevice = activeDevices.find((item) => item.name === device);
  const wantsSerial =
    requiresDevice && mode === 'existing' && Boolean(chosenDevice) && !chosenDevice?.serial_number;
  const wantsUsername =
    (declaredScope === 'User' || declaredScope === 'Both') && !detail.user.username;

  const update = (position: number, patch: Partial<DeviceInterface>) =>
    setInterfaces((current) =>
      current.map((item, index) => (index === position ? { ...item, ...patch } : item))
    );

  const canSubmit =
    Boolean(service) &&
    (!requiresDevice ||
      (mode === 'existing' ? Boolean(device) : hostname.trim().length > 0 && serial.trim().length > 0));

  const submit = async () => {
    try {
      await assign.mutateAsync({
        client_user: detail.user.name,
        service_item: service,
        effective_date: effectiveDate || undefined,
        target_scope: canChooseScope ? targetScope : undefined,
        device_mode: requiresDevice ? mode : 'none',
        managed_device: requiresDevice && mode === 'existing' ? device : undefined,
        hostname: requiresDevice && mode === 'new' ? hostname.trim() : undefined,
        serial_number:
          requiresDevice && (mode === 'new' || wantsSerial) ? serial.trim() || undefined : undefined,
        username: wantsUsername ? username.trim() || undefined : undefined,
        device_type: requiresDevice ? deviceType || undefined : undefined,
        interfaces: requiresDevice ? interfaces.filter((i) => i.mac_address.trim()) : undefined,
        notes: notes.trim() || undefined,
        source_request: sourceRequest || undefined,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Layers}
      tone="blue"
      title="Add a service"
      subtitle={`Opens immediately for ${detail.user.full_name}. The rate comes from the contract.`}
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
            onClick={submit}
            disabled={!canSubmit || assign.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {assign.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Add service'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Service</FieldLabel>
            <Select
              searchable
              className="w-full"
              value={service}
              onChange={setService}
              placeholder={available.length ? 'Select a service' : 'Every service is already open'}
              options={available.map((item) => ({
                value: item.name,
                label: item.item_name,
                description:
                  item.scope === 'Device'
                    ? 'Billed per device'
                    : item.scope === 'Both'
                      ? 'User or device'
                      : 'Billed per user',
              }))}
            />
          </div>
          <div>
            <span className={labelClass}>Effective date</span>
            <input
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {canChooseScope && (
          <div>
            <FieldLabel required>Attach it to</FieldLabel>
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              {(['User', 'Device'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setTargetScope(choice)}
                  className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
                    targetScope === choice
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {choice === 'User' ? 'The user' : 'A device'}
                </button>
              ))}
            </div>
          </div>
        )}

        {requiresDevice && (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2">
              <Laptop size={14} className="text-slate-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                This service is billed per device
              </span>
            </div>

            <div className="inline-flex rounded-lg bg-slate-200/70 p-1">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
                  mode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Existing device
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
                  mode === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                New device
              </button>
            </div>

            {mode === 'existing' ? (
              <Select
                searchable
                className="w-full"
                value={device}
                onChange={setDevice}
                placeholder={activeDevices.length ? 'Select a device' : 'This user has no device'}
                options={activeDevices.map((item) => ({
                  value: item.name,
                  label: item.hostname,
                  description: item.device_type,
                }))}
              />
            ) : (
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
                </div>
                <div>
                  <span className={labelClass}>Device type</span>
                  <Select
                    className="w-full"
                    value={deviceType}
                    onChange={setDeviceType}
                    placeholder="Select a type"
                    options={detail.device_types.map((type) => ({ value: type, label: type }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel required>Serial number</FieldLabel>
                  <input
                    type="text"
                    value={serial}
                    onChange={(event) => setSerial(event.target.value)}
                    placeholder="What is engraved on the case"
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Network interfaces</span>
                <button
                  type="button"
                  onClick={() =>
                    setInterfaces((current) => [
                      ...current,
                      { interface_type: 'Wi-Fi', mac_address: '' },
                    ])
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
                >
                  <Plus size={13} />
                  Add MAC
                </button>
              </div>

              {interfaces.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400">
                  No MAC address to record.
                </p>
              ) : (
                <div className="space-y-2">
                  {interfaces.map((item, position) => (
                    <div key={position} className="flex items-center gap-2">
                      <Select
                        className="w-36 shrink-0"
                        value={item.interface_type}
                        onChange={(value) => update(position, { interface_type: value })}
                        options={detail.interface_types.map((type) => ({
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
                          setInterfaces((current) =>
                            current.filter((_, index) => index !== position)
                          )
                        }
                        aria-label="Remove interface"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {(wantsSerial || wantsUsername) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">
            <p className="text-sm font-semibold text-amber-900">
              Missing for this service
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              The request cannot be closed without {wantsSerial && wantsUsername
                ? 'these'
                : 'this'}. Fill {wantsSerial && wantsUsername ? 'them' : 'it'} in now if you have{' '}
              {wantsSerial && wantsUsername ? 'them' : 'it'} to hand.
            </p>

            {wantsSerial && (
              <div className="mt-3">
                <span className={labelClass}>Serial number of {chosenDevice?.hostname}</span>
                <input
                  type="text"
                  value={serial}
                  onChange={(event) => setSerial(event.target.value)}
                  placeholder="Read it off the machine"
                  className={inputClass}
                />
              </div>
            )}

            {wantsUsername && (
              <div className="mt-3">
                <span className={labelClass}>Username for {detail.user.full_name}</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="The account name on the licence"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        )}

        <RequestReferenceField
          requests={detail.customer_requests}
          value={sourceRequest}
          onChange={setSourceRequest}
        />

        <div>
          <span className={labelClass}>Internal note</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Note or remark to keep saved."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {assign.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{assign.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AssignServiceModal;
