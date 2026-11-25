import React, { useEffect, useState } from 'react';
import { AlertCircle, Ban } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { CatalogueRow } from '@/lib/api/internal';
import { today } from '@/shared/lib/today';
import { useRemoveServiceFromMsp } from '../hooks/useCatalogue';

type Props = { service: CatalogueRow | null; contracts?: number; onClose: () => void };

const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

/** Stop offering a service. What is already running is the customer's, not the catalogue's. */
const RemoveFromMspModal: React.FC<Props> = ({ service, contracts = 0, onClose }) => {
  const remove = useRemoveServiceFromMsp();
  const [mode, setMode] = useState<'keep' | 'end'>('keep');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<{ assignment: string; message: string }[]>([]);

  useEffect(() => {
    if (!service) return;
    setMode('keep');
    setDate(today());
    setReason('');
    setFailed([]);
    remove.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  if (!service) return null;

  const open = service.open_assignments ?? 0;

  const submit = async () => {
    const out = await remove.mutateAsync({
      item: service.name,
      mode,
      effective_date: mode === 'end' ? date : undefined,
      reason: mode === 'end' ? reason.trim() : undefined,
    });

    if (out.failed.length) {
      setFailed(out.failed);

      return;
    }

    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Ban}
      tone="amber"
      title={open ? `Remove ${service.item_name} from MSP` : `Remove ${service.item_name} from MSP?`}
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={remove.isLoading || (mode === 'end' && !reason.trim())}
            className="rounded-full bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mode === 'end' ? `Remove and end ${open} assignments` : 'Remove from MSP'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {open === 0 ? (
          <p className="text-sm text-slate-600">
            It will no longer be available for new MSP assignments, requests or contracts. Existing
            history and invoices are kept. The ERPNext Item will remain enabled.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {open} open assignment(s) currently use this service. Choose what should happen to
              them.
            </p>

            {(
              [
                {
                  value: 'keep' as const,
                  label: 'Keep existing assignments',
                  description:
                    'Stop offering this service for new MSP work. Existing assignments stay active and remain billable.',
                },
                {
                  value: 'end' as const,
                  label: 'End active assignments',
                  description:
                    'Remove the service from MSP and end every open assignment using it.',
                },
              ]
            ).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition-colors ${
                  mode === option.value
                    ? 'bg-blue-50/60 ring-blue-300'
                    : 'bg-white ring-slate-200/70 hover:bg-slate-50/80'
                }`}
              >
                <input
                  type="radio"
                  name="removal-mode"
                  className="mt-0.5 size-4 accent-blue-500"
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}

            {mode === 'end' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel required>Effective date</FieldLabel>
                  <input
                    type="date"
                    className={inputClass}
                    value={date}
                    aria-label="Effective date"
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel required>Reason</FieldLabel>
                  <textarea
                    rows={2}
                    value={reason}
                    aria-label="Reason"
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why are all active assignments being ended?"
                    className="w-full resize-y rounded-xl border-0 bg-slate-100/80 px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {contracts > 0 && (
          <p className="rounded-xl bg-slate-50/70 px-3 py-2.5 ring-1 ring-slate-200/60 text-xs text-slate-600">
            This service is referenced by {contracts} active contract(s). Those contract records
            will not be changed.
          </p>
        )}

        {failed.length > 0 && (
          <div className="rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
            <p className="text-sm font-semibold text-amber-900">
              Service removed from MSP, but some assignments could not be ended.
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Successful closures were kept. Review the failed assignments below.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {failed.map((row) => (
                <li key={row.assignment}>
                  {row.assignment} · {row.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {remove.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{remove.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RemoveFromMspModal;
