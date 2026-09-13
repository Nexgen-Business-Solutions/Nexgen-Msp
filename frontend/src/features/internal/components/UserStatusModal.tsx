import React, { useEffect, useState } from 'react';
import { AlertCircle, UserCheck, UserX } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { UserDetail } from '@/lib/api/internal';
import { useDisableClientUser, useReactivateClientUser } from '../hooks/useUsers';

type Props = {
  open: boolean;
  detail: UserDetail;
  onClose: () => void;
};

const REASONS = ['Departure', 'Role Change', 'Duplicate', 'Contract Ended', 'Other'];

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

/** Leaving, or coming back. Either way the person's status is the only thing that moves. */
const UserStatusModal: React.FC<Props> = ({ open, detail, onClose }) => {
  const disable = useDisableClientUser();
  const reactivate = useReactivateClientUser();
  const { user, summary } = detail;
  const leaving = user.lifecycle_status !== 'Disabled';

  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reason, setReason] = useState('Departure');

  useEffect(() => {
    if (!open) return;
    setEffectiveDate(today());
    setReason('Departure');
    disable.reset();
    reactivate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = leaving ? disable : reactivate;

  const submit = async () => {
    try {
      if (leaving) {
        await disable.mutateAsync({ name: user.name, effective_date: effectiveDate, reason });
      } else {
        await reactivate.mutateAsync(user.name);
      }
      onClose();
    } catch {
      // surfaced below
    }
  };

  const services = summary.active_personal_services;
  const devices = summary.current_devices;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={leaving ? UserX : UserCheck}
      tone={leaving ? 'red' : 'blue'}
      title={leaving ? `Disable ${user.full_name}?` : `Reactivate ${user.full_name}?`}
      subtitle={
        leaving
          ? 'For somebody who has left the company.'
          : 'They become active again from today.'
      }
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
            disabled={(leaving && !effectiveDate) || mutation.isLoading}
            className={`flex min-w-[9rem] items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              leaving ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {mutation.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : leaving ? (
              'Disable user'
            ) : (
              'Reactivate'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {leaving ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required>Disabled from</FieldLabel>
                <input
                  type="date"
                  value={effectiveDate}
                  min={user.start_date ?? undefined}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel>Reason</FieldLabel>
                <Select
                  value={reason}
                  onChange={setReason}
                  options={REASONS.map((value) => ({ value, label: value }))}
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Nothing else changes on its own.</p>
              <p className="mt-1">
                {services > 0
                  ? `${services} personal service(s) stay open until you end them.`
                  : 'They have no open personal service.'}{' '}
                {devices > 0
                  ? `${devices} device(s) stay in their hands until you take them back.`
                  : 'They hold no device.'}
              </p>
            </div>
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            Services that were ended and devices that were taken back stay that way.
          </p>
        )}

        {mutation.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{mutation.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default UserStatusModal;
