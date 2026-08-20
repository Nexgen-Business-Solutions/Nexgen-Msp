import React, { useEffect, useState } from 'react';
import { AlertCircle, Laptop, Plus, Trash2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { DeviceInterface } from '@/lib/api/internal';
import { useCreateDevice, useCustomerUsers, useDeviceFilterOptions } from '../hooks/useDevices';

type Props = { open: boolean; onClose: () => void };

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_TYPES = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const NewDeviceModal: React.FC<Props> = ({ open, onClose }) => {
  const options = useDeviceFilterOptions();
  const create = useCreateDevice();

  const [customer, setCustomer] = useState('');
  const [holder, setHolder] = useState('');
  const [hostname, setHostname] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [serial, setSerial] = useState('');
  const [assignedDate, setAssignedDate] = useState(today());
  const [interfaces, setInterfaces] = useState<DeviceInterface[]>([
    { interface_type: 'Wi-Fi', mac_address: '' },
    { interface_type: 'LAN', mac_address: '' },
  ]);

  const users = useCustomerUsers(customer);

  useEffect(() => {
    if (!open) return;
    setCustomer('');
    setHolder('');
    setHostname('');
    setDeviceType('');
    setSerial('');
    setAssignedDate(today());
    setInterfaces([
      { interface_type: 'Wi-Fi', mac_address: '' },
      { interface_type: 'LAN', mac_address: '' },
    ]);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const change = (position: number, patch: Partial<DeviceInterface>) =>
    setInterfaces((current) =>
      current.map((item, index) => (index === position ? { ...item, ...patch } : item))
    );

  const submit = async () => {
    try {
      await create.mutateAsync({
        customer,
        hostname: hostname.trim(),
        device_type: deviceType || undefined,
        serial_number: serial.trim() || undefined,
        assigned_client_user: holder || undefined,
        assigned_date: assignedDate || undefined,
        interfaces: interfaces.filter((item) => item.mac_address.trim()),
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
      icon={Laptop}
      tone="indigo"
      title="Register a device"
      subtitle="Hardware only. Services are attached afterwards."
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
            disabled={!customer || !hostname.trim() || create.isLoading}
            className="flex min-w-[8rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {create.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Register device'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Customer</FieldLabel>
            <Select
              className="w-full"
              value={customer}
              onChange={(value) => {
                setCustomer(value);
                setHolder('');
              }}
              placeholder="Select a customer"
              options={(options.data?.customers ?? []).map((item) => ({
                value: item,
                label: item,
              }))}
            />
          </div>
          <div>
            <FieldLabel>Assigned to</FieldLabel>
            <Select
              className="w-full"
              value={holder}
              onChange={setHolder}
              placeholder={customer ? 'Nobody' : 'Pick the customer first'}
              options={[
                { value: '', label: 'Nobody', description: 'Keep it in stock' },
                ...(users.data ?? []).map((item) => ({
                  value: item.name,
                  label: item.full_name,
                  description: item.department ?? undefined,
                })),
              ]}
            />
          </div>
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
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Network interfaces</span>
            <button
              type="button"
              onClick={() =>
                setInterfaces((current) => [...current, { interface_type: 'Extra', mac_address: '' }])
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
                  onChange={(value) => change(position, { interface_type: value })}
                  options={INTERFACE_TYPES.map((type) => ({
                    value: type,
                    label: INTERFACE_LABEL[type] ?? type,
                  }))}
                />
                <input
                  type="text"
                  value={item.mac_address}
                  onChange={(event) => change(position, { mac_address: event.target.value })}
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

        {create.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{create.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default NewDeviceModal;
