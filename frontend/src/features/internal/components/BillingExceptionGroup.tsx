import React from 'react';
import { AlertCircle, Laptop, TriangleAlert, UserRound, X } from 'lucide-react';
import type { BillingRunLine } from '@/lib/api/internal';
import { useRemoveFromBillingRun } from '../hooks/useBilling';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

// what can honestly be done about each kind of blocker, in the words of the thing itself
const WAY_OUT: Record<string, string> = {
  'Missing Rate': 'Set a rate for this service on the customer’s contract, then revalidate.',
  'Already Invoiced': 'This period is already on another run. Take it off this one.',
  'Invalid Dates': 'Correct the service history before billing it. Billing must not rewrite it.',
  'Negative Quantity': 'Correct the quantity on the service assignment, then revalidate.',
  'Unapproved Override': 'A manual rate needs a reason on the service assignment.',
};

type Props = {
  run: string;
  lines: BillingRunLine[];
  canEdit: boolean;
};

/**
 * The blockers, grouped by what is wrong, each with its context in front of it.
 *
 * Nobody should have to hunt for one line in a table of four hundred to find out why a run
 * will not go through. And nothing here repairs a service's own history to save a click:
 * some things are corrected where they live, and this says which.
 */
const BillingExceptionGroup: React.FC<Props> = ({ run, lines, canEdit }) => {
  const drop = useRemoveFromBillingRun();
  const blocked = lines.filter((line) => line.exception_code);

  if (!blocked.length) return null;

  const groups = new Map<string, BillingRunLine[]>();

  for (const line of blocked) {
    const code = line.exception_code as string;
    groups.set(code, [...(groups.get(code) ?? []), line]);
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-bold text-amber-900">
        <TriangleAlert size={15} className="text-amber-600" />
        {blocked.length} line{blocked.length > 1 ? 's' : ''} cannot be billed
      </h2>
      <p className="mt-0.5 text-xs text-amber-800">
        This run cannot be approved until each one is fixed or taken off it.
      </p>

      <div className="mt-3 space-y-3">
        {[...groups.entries()].map(([code, rows]) => (
          <div key={code} className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              {code}
              <span className="ml-2 font-normal normal-case text-slate-400">{rows.length}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{WAY_OUT[code] ?? rows[0].exception_detail}</p>

            <div className="mt-2 space-y-2">
              {rows.map((line) => (
                <div
                  key={line.line ?? line.service_assignment}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{line.service_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                      {line.user_name && (
                        <span className="inline-flex items-center gap-1">
                          <UserRound size={11} className="text-slate-400" />
                          {line.user_name}
                          {line.department ? ` · ${line.department}` : ''}
                        </span>
                      )}
                      {line.hostname && (
                        <span className="inline-flex items-center gap-1">
                          <Laptop size={11} className="text-slate-400" />
                          {line.hostname}
                          {line.serial_number ? ` · ${line.serial_number}` : ''}
                        </span>
                      )}
                      <span>
                        {fmtDate(line.covered_from)} → {fmtDate(line.covered_to)}
                      </span>
                    </p>
                    {line.exception_detail && (
                      <p className="mt-0.5 text-xs text-amber-800">{line.exception_detail}</p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      disabled={drop.isLoading}
                      onClick={() =>
                        drop.mutate({ name: run, service_assignment: line.service_assignment })
                      }
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                    >
                      <X size={12} />
                      Remove from this run
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {drop.error instanceof Error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {drop.error.message}
        </p>
      )}
    </section>
  );
};

export default BillingExceptionGroup;
