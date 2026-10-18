import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarRange, ReceiptText, Undo2 } from 'lucide-react';
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
  // a credit is asked for either as a number of months, or as the stretch that was not
  // served — an outage has dates, not months, and the conversion belongs on the server
  const [mode, setMode] = useState<'months' | 'period'>('months');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked({});
    setReason('');
    setMode('months');
    setFrom('');
    setTo('');
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run]);

  const lines = (creditable.data?.lines ?? []).filter((line) => line.remaining_months > 0);
  const currency = creditable.data?.currency ?? '';

  const toggle = (line: (typeof lines)[number]) =>
    setPicked((current) => {
      const next = { ...current };
      if (line.service_assignment in next) delete next[line.service_assignment];
      // a line that stopped early is nearly always ticked to give those days back, and
      // nothing else: the whole charge is still one keystroke away
      else next[line.service_assignment] = line.owed_back?.months ?? line.remaining_months;
      return next;
    });

  const setMonths = (assignment: string, value: number) =>
    setPicked((current) => ({ ...current, [assignment]: value }));

  const total = lines.reduce((sum, line) => {
    const months = picked[line.service_assignment];
    return months ? sum + months * (line.unit_rate ?? 0) * line.quantity : sum;
  }, 0);

  const owed = lines.filter((line) => line.owed_back);
  const owedMonths = creditable.data?.owed_back_months ?? 0;

  /** Take the proposal as it stands: every line that stopped early, for what it owes. */
  const takeTheProposal = () => {
    setMode('months');
    setPicked(
      Object.fromEntries(owed.map((line) => [line.service_assignment, line.owed_back!.months]))
    );
  };

  const days =
    from && to
      ? Math.floor(
          (new Date(to).getTime() - new Date(from).getTime()) / 86400000
        ) + 1
      : 0;

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        name: run,
        lines: Object.keys(picked).map((service_assignment) =>
          mode === 'period'
            ? { service_assignment, from, to }
            : { service_assignment, months: picked[service_assignment] }
        ),
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
            {mode === 'period' ? (
              <span className="font-semibold text-slate-800">
                {days > 0 ? `${days} day(s)` : 'no period yet'}
              </span>
            ) : (
              <span className="font-semibold text-slate-800">
                {Math.round(total).toLocaleString()} {currency}
              </span>
            )}{' '}
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
              disabled={
                !chosen ||
                !reason.trim() ||
                create.isLoading ||
                (mode === 'period' && (!from || !to || days <= 0))
              }
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
        {owed.length > 0 && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm text-blue-900">
              <span className="font-semibold">
                {owed.length} line(s) stopped before the period they were paid for.
              </span>{' '}
              {owedMonths} month(s) were charged for days nobody was served.
            </p>
            <button
              type="button"
              onClick={takeTheProposal}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
            >
              <Undo2 size={13} />
              Give those days back
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(
              [
                ['months', 'By months'],
                ['period', 'By period'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === value
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'period' && (
            <>
              <label className="text-xs font-medium text-slate-500">
                <span className="mb-1 block">Not served from</span>
                <input
                  type="date"
                  value={from}
                  min={creditable.data?.period_start}
                  max={creditable.data?.period_end}
                  onChange={(event) => setFrom(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                <span className="mb-1 block">to</span>
                <input
                  type="date"
                  value={to}
                  min={from || creditable.data?.period_start}
                  max={creditable.data?.period_end}
                  onChange={(event) => setTo(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                />
              </label>
              <p className="pb-2 text-xs text-slate-400">
                <CalendarRange size={12} className="mr-1 inline" />
                Applied to every line ticked below, cut the way this contract prorates.
              </p>
            </>
          )}
        </div>

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
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
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
                      {line.owed_back && (
                        <span className="mt-0.5 block text-[11px] font-normal text-blue-700">
                          ended {line.owed_back.ended_on} · {line.owed_back.unused_days} day(s)
                          unused
                        </span>
                      )}
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
                        disabled={mode === 'period' || !(line.service_assignment in picked)}
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
