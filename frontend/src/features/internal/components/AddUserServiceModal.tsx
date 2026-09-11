import React, { useEffect, useState } from 'react';
import { AlertCircle, Layers } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { CustomerRequestRef, UserDetail } from '@/lib/api/internal';
import RequestReferenceField from './RequestReferenceField';
import { useAssignService, useUserServiceAvailability } from '../hooks/useUsers';

type Props = {
  open: boolean;
  user: UserDetail['user'];
  requests: CustomerRequestRef[];
  defaultRequest?: string;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const AddUserServiceModal: React.FC<Props> = ({
  open,
  user,
  requests,
  defaultRequest,
  onClose,
}) => {
  const availability = useUserServiceAvailability(open ? user.name : undefined);
  const assign = useAssignService(user.name);

  const [service, setService] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceRequest, setSourceRequest] = useState('');

  useEffect(() => {
    if (!open) return;
    setService('');
    setEffectiveDate(today());
    setNotes('');
    setSourceRequest(defaultRequest ?? '');
    assign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const data = availability.data;
  const refusal = data?.target_reason ?? null;
  const available = data?.available ?? [];
  const nothingLeft = Boolean(data) && !refusal && available.length === 0;

  const submit = async () => {
    try {
      await assign.mutateAsync({
        client_user: user.name,
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
      open={open}
      onClose={onClose}
      icon={Layers}
      tone="blue"
      title="Add service"
      subtitle="A personal service, opened on this person. The rate comes from the contract."
      widthClass="max-w-lg"
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
              'Activate service'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{user.full_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[user.department, user.email].filter(Boolean).join(' · ') || user.customer}
          </p>
        </div>

        {availability.isLoading && (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        )}

        {!!availability.error && (
          <p className="py-6 text-center text-sm text-red-600">
            {(availability.error as Error)?.message || 'Failed to read what can be added.'}
          </p>
        )}

        {refusal && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <span className="text-sm font-medium text-amber-900">{refusal}</span>
          </div>
        )}

        {nothingLeft && (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            {user.full_name} already has every service currently available.
          </p>
        )}

        {data && !refusal && available.length > 0 && (
          <>
            <div>
              <FieldLabel required>Service</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={service}
                onChange={setService}
                placeholder="Select a service"
                options={available.map((item) => ({
                  value: item.service_item,
                  label: item.item_name,
                  description:
                    item.service_scope === 'Both' ? 'User or device' : 'Billed per user',
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

            <RequestReferenceField
              requests={requests}
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
          </>
        )}

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

export default AddUserServiceModal;
