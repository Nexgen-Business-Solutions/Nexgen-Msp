import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { WorkCard } from '@/lib/api/internal';
import { useCustomerUsers } from '../../hooks/useDevices';
import { useExecuteDeviceOperation } from '../../hooks/useRequests';
import { inputClass } from '../../lib/fulfilmentStyles';

type Props = {
  card: WorkCard | null;
  customer: string;
  onClose: () => void;
};

// the acts that hand a machine to somebody, and so need one named before they can run
const NEEDS_HOLDER = ['device.assign', 'device.transfer'];

/** What an act on a machine needs: the day it takes effect, and who ends up holding it. */
const DeviceOperationModal: React.FC<Props> = ({ card, customer, onClose }) => {
  const run = useExecuteDeviceOperation();
  const people = useCustomerUsers(customer);
  const [date, setDate] = useState('');
  const [holder, setHolder] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!card) return;
    setDate(card.effective_date ?? new Date().toISOString().slice(0, 10));
    setHolder(card.requested_holder ?? '');
    setReason('');
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  if (!card) return null;

  const code = card.operation_code ?? '';
  const needsHolder = NEEDS_HOLDER.includes(code);
  const overriding = Boolean(card.requested_holder) && holder !== card.requested_holder;
  const label = card.action_label ?? code;

  const submit = async () => {
    try {
      await run.mutateAsync({
        work_order: card.name,
        effective_date: date || undefined,
        execution_holder: needsHolder ? holder : undefined,
        override_reason: overriding ? reason.trim() : undefined,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Play}
      tone="blue"
      title={label}
      subtitle={[card.device?.hostname, card.device?.serial_number].filter(Boolean).join(' · ')}
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit()}
            disabled={
              run.isLoading ||
              (needsHolder && !holder) ||
              (overriding && !reason.trim()) ||
              card.holder_changed
            }
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {run.isLoading ? 'Working…' : label}
          </button>
        </div>
      }
    >
      {/* the machine may have changed hands since the customer asked: nothing runs on its own */}
      {card.holder_changed && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-sm font-semibold text-amber-900">
            The Device holder changed after this request was submitted. Review the current holder
            before continuing.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Requested from
              </p>
              <p className="text-sm text-amber-900">{card.snapshot_holder_name || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Current holder
              </p>
              <p className="text-sm text-amber-900">{card.current_holder_name || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Requested new holder
              </p>
              <p className="text-sm text-amber-900">{card.requested_holder_name || 'Unassigned'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Effective date</FieldLabel>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Effective date"
          />
        </div>

        {needsHolder && (
          <>
            {card.requested_holder && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Requested holder
                </p>
                <p className="text-sm text-slate-800">
                  {card.requested_holder_name || card.requested_holder}
                </p>
              </div>
            )}

            <div className="sm:col-span-2">
              <FieldLabel required>Execution holder</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={holder}
                onChange={setHolder}
                placeholder="Choose who ends up holding it"
                options={(people.data ?? []).map((person) => ({
                  value: person.name,
                  label: person.full_name,
                  description: person.department ?? undefined,
                }))}
              />
            </div>

            {overriding && (
              <div className="sm:col-span-2">
                <FieldLabel required>Reason for changing the requested holder</FieldLabel>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why Nexgen is executing the transfer to a different person."
                  aria-label="Reason for changing the requested holder"
                />
              </div>
            )}
          </>
        )}
      </div>

      {card.technician_reason && (
        <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800">
          Added by the technician: {card.technician_reason}
        </p>
      )}

      {run.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {run.error.message}
        </p>
      )}
    </Modal>
  );
};

export default DeviceOperationModal;
