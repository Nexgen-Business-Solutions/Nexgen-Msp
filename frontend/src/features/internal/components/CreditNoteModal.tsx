import React, { useEffect, useState } from 'react';
import { AlertCircle, ReceiptText } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useCreateCreditNote, useCreditableLines } from '../hooks/useBilling';

type Props = {
  open: boolean;
  run: string;
  onClose: () => void;
  onCreated: (name: string) => void;
};

const CreditNoteModal: React.FC<Props> = ({ open, run, onClose, onCreated }) => {
  const creditable = useCreditableLines(open ? run : undefined);
  const create = useCreateCreditNote();

  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked({});
    setReason('');
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run]);

  const lines = (creditable.data?.lines ?? []).filter((line) => line.remaining_months > 0);
  const currency = creditable.data?.currency ?? '';

  const toggle = (line: (typeof lines)[number]) =>
    setPicked((current) => {
      const next = { ...current };
      if (line.service_assignment in next) delete next[line.service_assignment];
      else next[line.service_assignment] = line.remaining_months;
      return next;
    });

  const setMonths = (assignment: string, value: number) =>
    setPicked((current) => ({ ...current, [assignment]: value }));

  const total = lines.reduce((sum, line) => {
    const months = picked[line.service_assignment];
    return months ? sum + months * (line.unit_rate ?? 0) * line.quantity : sum;
  }, 0);

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        name: run,
        lines: Object.entries(picked).map(([service_assignment, months]) => ({
          service_assignment,
          months,
        })),
        reason,
      });
      onCreated(created.name);
    } catch {
      // surfaced by the banner below
    }
  };

  const chosen = Object.keys(picked).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={ReceiptText}
      tone="blue"
      title="Contest this invoice"
      subtitle={`${creditable.data?.customer ?? ''} — credit back what should not have been billed.`}
      widthClass="max-w-4xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {chosen} line(s) ·{' '}
            <span className="font-semibold text-slate-800">
              {Math.round(total).toLocaleString()} {currency}
            </span>{' '}
            to credit
          </p>
          <div className="flex items-center gap-2">
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
              disabled={!chosen || !reason.trim() || create.isLoading}
              className="flex min-w-[9rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {create.isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                'Prepare credit note'
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <FieldLabel required>Reason</FieldLabel>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="max-h-[22rem] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {['', 'User', 'Service', 'Billed', 'Credited', 'To credit'].map(
                    (column, index) => (
                      <th
                        key={column || index}
                        className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                          index >= 3 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {column}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={line.service_assignment} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={line.service_assignment in picked}
                        onChange={() => toggle(line)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-800">
                      {line.user_name || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                      {line.service_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-600 tabular-nums">
                      {line.billable_months}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-500 tabular-nums">
                      {line.credited_months || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max={line.remaining_months}
                        disabled={!(line.service_assignment in picked)}
                        value={picked[line.service_assignment] ?? ''}
                        onChange={(event) =>
                          setMonths(line.service_assignment, Number(event.target.value))
                        }
                        className="h-8 w-20 rounded-md border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-300"
                      />
                    </td>
                  </tr>
                ))}

                {lines.length === 0 && !creditable.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                      Every line on this invoice has already been credited back.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

export default CreditNoteModal;
