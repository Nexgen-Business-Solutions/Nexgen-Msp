import React, { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import RequestReferenceField from './RequestReferenceField';
import { useAssignDeviceService, useDeviceContext } from '../hooks/useDevices';

type Props = {
  device: string | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const DeviceServiceModal: React.FC<Props> = ({ device, onClose }) => {
  const context = useDeviceContext(device);
  const assign = useAssignDeviceService();

  const [service, setService] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceRequest, setSourceRequest] = useState('');

  useEffect(() => {
    if (!device) return;
    setService('');
    setEffectiveDate(today());
    setNotes('');
    setSourceRequest('');
    assign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  const data = context.data;
  const available = (data?.catalogue ?? []).filter((item) => !item.already_open);

  const submit = async () => {
    if (!device) return;

    try {
      await assign.mutateAsync({
        device,
        service_item: service,
        effective_date: effectiveDate || undefined,
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
      open={Boolean(device)}
      onClose={onClose}
      icon={ShieldCheck}
      tone="emerald"
      title="Add a service to this device"
      subtitle={
        data
          ? `${data.device.hostname}${data.user_name ? ` · held by ${data.user_name}` : ' · unassigned'}`
          : undefined
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
            onClick={submit}
            disabled={!service || assign.isLoading}
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
      {context.isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}

      {!!context.error && (
        <p className="py-8 text-center text-sm text-red-600">
          {(context.error as Error)?.message || 'Failed to load this device.'}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel required>Service</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={service}
                onChange={setService}
                placeholder={
                  available.length ? 'Select a service' : 'No device service left to add'
                }
                options={available.map((item) => ({
                  value: item.name,
                  label: item.item_name,
                  description: item.scope === 'Both' ? 'User or device' : 'Billed per device',
                }))}
              />
            </div>
            <div>
              <FieldLabel>Effective date</FieldLabel>
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <RequestReferenceField
            requests={data.customer_requests}
            value={sourceRequest}
            onChange={setSourceRequest}
          />

          <div>
            <FieldLabel>Internal note</FieldLabel>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What you did and why — kept for Nexgen, not shown to the customer."
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
      )}
    </Modal>
  );
};

export default DeviceServiceModal;
