import React, { useState } from 'react';
import { AlertCircle, FileSearch, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import {
  useCoverageEvidence,
  useCoveragePreview,
  useRecordPastCoverage,
} from '../hooks/useBilling';

type Props = {
  open: boolean;
  customers: { value: string; label: string }[];
  /** the company the screen was already filtered to, if it was */
  defaultCustomer?: string;
  /** the period the screen already knows was charged, when it comes from a proposal */
  defaultPeriod?: { from: string; to: string } | null;
  onClose: () => void;
  onRecorded: (run: string) => void;
};

const INPUT =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-blue-400';

const money = (amount: number, currency: string) =>
  `${Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`.replace(
    /,/g,
    ' '
  );

/**
 * Writing down a charge this application never raised.
 *
 * A customer billed by whatever served them before arrives with nothing to credit against.
 * Rather than assume the period was paid for, the evidence is looked for first — runs that
 * overlap, the customer's own posted invoices around those dates — and whoever records it
 * says in their own words where the charge came from. That statement is kept with the run.
 */
const PastCoverageModal: React.FC<Props> = ({
  open,
  customers,
  defaultCustomer,
  defaultPeriod,
  onClose,
  onRecorded,
}) => {
  const [customer, setCustomer] = useState(defaultCustomer ?? '');
  const [from, setFrom] = useState(defaultPeriod?.from ?? '');
  const [until, setUntil] = useState(defaultPeriod?.to ?? '');
  const [asked, setAsked] = useState<{ period_start: string; period_end: string } | null>(null);
  const [contract, setContract] = useState('');
  const [invoice, setInvoice] = useState('');
  const [issued, setIssued] = useState('');
  const [statement, setStatement] = useState('');
  const [left, setLeft] = useState<string[]>([]);

  const evidence = useCoverageEvidence(asked && customer ? { customer, ...asked } : null);
  const preview = useCoveragePreview(
    asked && contract && issued ? { contract, ...asked, invoice_date: issued } : null
  );
  const record = useRecordPastCoverage();

  const found = evidence.data;
  const charged = (preview.data?.lines ?? []).filter((line) => !line.exception_code);
  // every line of the proposal is recorded unless somebody says it was not on the document
  const attested = charged
    .map((line) => line.service_assignment)
    .filter((assignment) => !left.includes(assignment));
  const error = (evidence.error ?? preview.error ?? record.error) as Error | undefined;

  const look = () => {
    setContract('');
    setInvoice('');
    setLeft([]);
    setAsked(customer && from && until ? { period_start: from, period_end: until } : null);
  };

  const pick = (chosen: string) => {
    setCustomer(chosen);
    setContract('');
    setInvoice('');
    setAsked(null);
  };

  const save = async () => {
    if (!asked || !contract || !issued) return;

    try {
      const run = await record.mutateAsync({
        contract,
        ...asked,
        statement: statement.trim(),
        sales_invoice: invoice || null,
        invoice_date: issued,
        attested,
      });
      onRecorded(run.name);
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={FileSearch}
      tone="blue"
      title="Record a past invoice"
      subtitle="A period charged before this application existed, so it can be credited back."
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              !contract ||
              !issued ||
              !statement.trim() ||
              attested.length === 0 ||
              record.isLoading
            }
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Record as charged
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-700">Customer</span>
          <Select
            className="w-full"
            searchable
            value={customer}
            onChange={pick}
            placeholder="Choose the customer"
            options={customers}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">
              Period charged, from
            </span>
            <input
              type="date"
              className={INPUT}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">To</span>
            <input
              type="date"
              className={INPUT}
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={look}
            disabled={!customer || !from || !until}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Find the evidence
          </button>
        </div>

        {found && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                What this application found
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                <li>
                  {found.runs.length === 0
                    ? 'No billing run covers any part of this period.'
                    : `${found.runs.length} billing run(s) overlap: ${found.runs
                        .map((row) => row.name)
                        .join(', ')}.`}
                </li>
                <li>
                  {found.invoices.length === 0
                    ? 'No posted invoice of this customer sits near these dates.'
                    : `${found.invoices.length} posted invoice(s) around these dates.`}
                </li>
              </ul>
            </div>

            <div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                  The day the original charge went out
                </span>
                <input
                  type="date"
                  className={INPUT}
                  value={issued}
                  onChange={(event) => setIssued(event.target.value)}
                />
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Everything below is read as it stood on that day, so it is the date on the
                document itself, not the start of the period.
              </p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Charged under which contract
              </span>
              <Select
                className="w-full"
                value={contract}
                onChange={setContract}
                placeholder="Choose the contract"
                options={found.contracts.map((row) => ({
                  value: row.name,
                  label: row.title || row.name,
                  description: [row.billing_frequency, row.billing_timing, row.proration_method]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            </label>

            {found.invoices.length > 0 && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                  The original invoice, if it is one of these
                </span>
                <Select
                  className="w-full"
                  value={invoice}
                  onChange={setInvoice}
                  placeholder="Charged outside this application"
                  options={found.invoices.map((row) => ({
                    value: row.name,
                    label: row.name,
                    description: `${row.posting_date} · ${money(row.grand_total, row.currency)}`,
                  }))}
                />
              </label>
            )}
            {found.invoices.length > 0 && (
              <p className="-mt-2 text-[11px] text-slate-500">
                Linked, the credit is a return against it. Left empty, it is a credit note
                of its own, because there is nothing here to return against.
              </p>
            )}

            {contract && issued && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  What that period would have held
                </p>
                {preview.isLoading ? (
                  <p className="mt-2 text-sm text-slate-500">Working it out…</p>
                ) : charged.length === 0 ? (
                  <p className="mt-2 flex items-start gap-2 text-sm text-amber-800">
                    <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    Nothing was running over this period, so there is nothing that charge
                    could have covered.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-semibold">{attested.length}</span> of{' '}
                      {charged.length} line(s) recorded,{' '}
                      <span className="font-semibold">
                        {money(preview.data?.total_amount ?? 0, preview.data?.currency ?? '')}
                      </span>{' '}
                      as proposed.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      This is what this application believes was running on{' '}
                      {preview.data?.as_known_on}. Untick anything the original document
                      does not carry — what stays is what the record will say was charged.
                    </p>
                    <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
                      {charged.map((line) => (
                        <li key={line.service_assignment}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-blue-600"
                              checked={!left.includes(line.service_assignment)}
                              onChange={(event) =>
                                setLeft((current) =>
                                  event.target.checked
                                    ? current.filter((name) => name !== line.service_assignment)
                                    : [...current, line.service_assignment]
                                )
                              }
                            />
                            <span className="font-semibold text-slate-700">
                              {line.service_name}
                            </span>
                            <span className="truncate text-slate-500">
                              {line.user_name || line.hostname || 'Customer'}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums text-slate-500">
                              {money(line.amount, preview.data?.currency ?? '')}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Where this charge came from
                </span>
                <textarea
                  rows={3}
                  className={INPUT}
                  placeholder="e.g. Charged by the previous system, invoice KAK-2026-Q3 of 24 July 2026."
                  value={statement}
                  onChange={(event) => setStatement(event.target.value)}
                />
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Kept with the record, under your name. A coverage nobody can trace back
                cannot justify a credit later.
              </p>
            </div>
          </>
        )}

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

export default PastCoverageModal;
