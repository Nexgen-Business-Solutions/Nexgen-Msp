import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Pencil } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import InterfaceEditor from '@/shared/components/InterfaceEditor';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { DeviceInterface, DeviceRow } from '@/lib/api/internal';
import {
  useDeviceFilterOptions,
  useHostnameMatch,
  useSerialMatch,
  useUpdateDevice,
} from '../hooks/useDevices';

type Props = {
  device: DeviceRow | null;
  interfaceTypes?: string[];
  onClose: () => void;
};

const INTERFACE_TYPES = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const EditDeviceModal: React.FC<Props> = ({ device, onClose }) => {
  const navigate = useNavigate();
  const options = useDeviceFilterOptions();
  const update = useUpdateDevice();

  const [hostname, setHostname] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [serial, setSerial] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [model, setModel] = useState('');
  const [operatingSystem, setOperatingSystem] = useState('');
  const [interfaces, setInterfaces] = useState<DeviceInterface[]>([]);

  useEffect(() => {
    if (!device) return;
    setHostname(device.hostname);
    setDeviceType(device.device_type);
    setSerial(device.serial_number ?? '');
    setAssignedDate((device.assigned_date ?? '').slice(0, 10));
    setModel(device.model ?? '');
    setOperatingSystem(device.operating_system ?? '');
    setInterfaces(device.interfaces ?? []);
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  // renaming into a name another machine already carries fails at save, so it is said here
  const clash = useHostnameMatch(device?.customer, hostname.trim());
  const taken = clash.data?.name && clash.data.name !== device?.name ? clash.data : null;

  const serialClash = useSerialMatch(serial.trim(), device?.name);
  const serialTaken = serialClash.data?.name ? serialClash.data : null;

  const submit = async () => {
    if (!device) return;

    try {
      await update.mutateAsync({
        device: device.name,
        hostname: hostname.trim(),
        device_type: deviceType || undefined,
        serial_number: serial.trim() || undefined,
        assigned_date: assignedDate || undefined,
        model: model.trim(),
        operating_system: operatingSystem.trim(),
        interfaces: interfaces.filter((item) => item.mac_address.trim()),
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={Boolean(device)}
      onClose={onClose}
      icon={Pencil}
      tone="slate"
      title="Edit this device"
      subtitle={device ? `${device.hostname} · ${device.customer}` : undefined}
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
            disabled={!hostname.trim() || Boolean(serialTaken) || update.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {update.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
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
              className={`${inputClass} uppercase`}
            />
            {taken && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">{taken.hostname}</span> is already taken by{' '}
                  {taken.same_customer ? taken.name : `${taken.customer} (${taken.name})`}. Names
                  may be shared — the serial number is what has to be unique.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(`/msp/devices/${taken.name}`);
                  }}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  Open it
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </div>
          <div>
            <FieldLabel>Device type</FieldLabel>
            <Select
              className="w-full"
              value={deviceType}
              onChange={setDeviceType}
              placeholder="Select a type"
              options={(options.data?.device_types ?? []).map((type) => ({
                value: type,
                label: type,
              }))}
            />
          </div>
          <div>
            <FieldLabel>Serial number</FieldLabel>
            <input
              type="text"
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              className={inputClass}
            />
            {serialTaken && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                Already on <span className="font-semibold">{serialTaken.hostname}</span> (
                {serialTaken.customer}). Two records cannot share a serial number.
              </p>
            )}
          </div>
          <div>
            <FieldLabel>In service since</FieldLabel>
            <input
              type="date"
              value={assignedDate}
              onChange={(event) => setAssignedDate(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Model</FieldLabel>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="What the case says"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Operating system</FieldLabel>
            <input
              type="text"
              value={operatingSystem}
              onChange={(event) => setOperatingSystem(event.target.value)}
              placeholder="Windows 11 Pro"
              className={inputClass}
            />
          </div>
        </div>

        <InterfaceEditor
          value={interfaces}
          onChange={setInterfaces}
          suggestions={INTERFACE_TYPES}
        />

        {update.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{update.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EditDeviceModal;
