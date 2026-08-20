import React, { useEffect, useState } from 'react';
import { AlertCircle, Laptop, Plus, Trash2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { CustomerRequestRef, DeviceInterface } from '@/lib/api/internal';
import RequestReferenceField from './RequestReferenceField';
import { useAddDevice } from '../hooks/useUsers';

type Props = {
  open: boolean;
  clientUser: string;
  userName: string;
  deviceTypes: string[];
  interfaceTypes: string[];
  requests: CustomerRequestRef[];
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

const AddDeviceModal: React.FC<Props> = ({
  open,
  clientUser,
  userName,
  deviceTypes,
  interfaceTypes,
  requests,
  defaultRequest,
  onClose,
}) => {
  const add = useAddDevice(clientUser);

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
    setHostname('');
    setDeviceType('');
    setSerial('');
    setAssignedDate(today());
    setSourceRequest(defaultRequest ?? '');
    setInterfaces([
      { interface_type: 'Wi-Fi', mac_address: '' },
      { interface_type: 'LAN', mac_address: '' },
    ]);
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      subtitle={`Register hardware for ${userName}. Services are attached separately, through a request.`}
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
            disabled={!hostname.trim() || add.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {add.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Add device'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
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
              options={deviceTypes.map((type) => ({ value: type, label: type }))}
            />
          </div>
          <div>
            <span className={labelClass}>Serial number</span>
            <input
              type="text"
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
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

        <RequestReferenceField
          requests={requests}
          value={sourceRequest}
          onChange={setSourceRequest}
        />

        {add.error instanceof Error && (
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
