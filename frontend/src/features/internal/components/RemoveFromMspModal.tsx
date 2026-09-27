import React, { useEffect, useState } from 'react';
import { AlertCircle, Ban } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { CatalogueRow } from '@/lib/api/internal';
import { useRemoveServiceFromMsp } from '../hooks/useCatalogue';

type Props = { service: CatalogueRow | null; contracts?: number; onClose: () => void };

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

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
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={remove.isLoading || (mode === 'end' && !reason.trim())}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  mode === option.value ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="removal-mode"
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                  <span className="block text-xs text-slate-500">{option.description}</span>
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
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {contracts > 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            This service is referenced by {contracts} active contract(s). Those contract records
            will not be changed.
          </p>
        )}

        {failed.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
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
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{remove.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RemoveFromMspModal;
