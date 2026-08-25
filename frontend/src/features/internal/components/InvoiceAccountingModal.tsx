import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Receipt } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { BillingRunDetail } from '@/lib/api/internal';
import { useInvoiceDimensions } from '../hooks/useBilling';

type Props = {
  open: boolean;
  run: BillingRunDetail | null;
  loading?: boolean;
  error?: Error;
  onClose: () => void;
  onConfirm: (dimensions: Record<string, string>) => void;
};

const FREEZES = 'Freezing the run and drawing its invoice, in one step.';
const DRAWS = 'Drawing the invoice from the frozen run.';

const money = (value: number, currency?: string | null) =>
  `${currency ? `${currency} ` : ''}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const InvoiceAccountingModal: React.FC<Props> = ({
  open,
  run,
  loading,
  error,
  onClose,
  onConfirm,
}) => {
  const dimensions = useInvoiceDimensions(open);
  const [values, setValues] = useState<Record<string, string>>({});

  const fields = useMemo(() => dimensions.data ?? [], [dimensions.data]);

  useEffect(() => {
    if (!open || !fields.length) return;
    setValues((current) => {
      const next = { ...current };
      fields.forEach((field) => {
        if (next[field.fieldname]) return;
        next[field.fieldname] =
          field.default ?? (field.options.length === 1 ? field.options[0] : '');
      });
      return next;
    });
  }, [open, fields]);

  const missing = fields.filter((field) => field.mandatory && !values[field.fieldname]);

  // what the run holds today; ERPNext recomputes the authoritative figures on creation
  const lines = (run?.lines ?? []).filter((line) => !line.exception_code);
  const preview = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Receipt}
      tone="emerald"
      title={run?.can_approve ? 'Approve and invoice' : 'Create the invoice'}
      subtitle={run ? `${run.customer} — ${run.period_label}` : undefined}
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
            onClick={() => onConfirm(values)}
            disabled={missing.length > 0 || loading || dimensions.isLoading}
            className="flex min-w-[9rem] items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : run?.can_approve ? (
              'Approve and invoice'
            ) : (
              'Create invoice'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Customer & contract
          </p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-slate-400">Customer</p>
              <p className="mt-0.5 text-sm text-slate-700">{run?.customer}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Contract</p>
              <p className="mt-0.5 text-sm text-slate-700">
                {run?.contract_title || run?.contract || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Period</p>
              <p className="mt-0.5 text-sm text-slate-700">{run?.period_label}</p>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Accounting
          </p>

          {dimensions.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.fieldname}>
                <FieldLabel required={field.mandatory}>{field.label}</FieldLabel>
                <Select
                  searchable
                  className="w-full"
                  value={values[field.fieldname] ?? ''}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.fieldname]: value }))
                  }
                  placeholder={field.mandatory ? 'Pick one' : 'None'}
                  options={[
                    ...(field.mandatory ? [] : [{ value: '', label: 'None' }]),
                    ...field.options.map((option) => ({ value: option, label: option })),
                  ]}
                />
              </div>
            ))}
          </div>

          <p className="mt-2 text-sm text-slate-500">
            These land on the invoice and on each of its lines. Defaults come from Settings.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            What will be invoiced
          </p>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold tabular-nums">{lines.length}</span> line(s) ·{' '}
              <span className="font-semibold tabular-nums">
                {money(preview, run?.currency)}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {run?.can_approve ? FREEZES : DRAWS} Nothing reaches the ledger yet — the
              invoice is drafted, and posting it stays a separate decision. Taxes and the
              final total are computed by ERPNext.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default InvoiceAccountingModal;
