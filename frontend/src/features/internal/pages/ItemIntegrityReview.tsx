import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useItemIntegrityAudit, useRestoreItemState } from '../hooks/useSettings';
import type { ItemIntegrityRow } from '@/lib/api/internal';

const SAFE = 'Safe to restore';
const REVIEW = 'Needs review';
const LEAVE = 'No change recommended';

const GROUPS = [SAFE, REVIEW, LEAVE] as const;

const COLUMNS = ['Item', 'Current state', 'Previous proven state', 'Evidence', 'MSP usage', 'Action'];

const state = (row: ItemIntegrityRow) =>
  [
    row.disabled ? 'Disabled' : 'Enabled',
    `Stock UOM: ${row.stock_uom ?? 'N/A'}`,
    `Sales UOM: ${row.sales_uom ?? 'N/A'}`,
  ].join(' · ');

const proven = (row: ItemIntegrityRow) => {
  const entries = Object.entries(row.restorable ?? {});

  if (!entries.length) return 'None';

  return entries
    .map(([field, detail]) =>
      field === 'disabled'
        ? `Enabled (${detail.previous ? 'disabled' : 'enabled'})`
        : `${field === 'stock_uom' ? 'Stock UOM' : 'Sales UOM'}: ${detail.previous}`
    )
    .join(' · ');
};

const usage = (row: ItemIntegrityRow) =>
  [
    `${row.open_msp_assignments} open`,
    `${row.historical_msp_assignments} past`,
    `${row.msp_contract_references} contract(s)`,
    `${row.msp_billing_line_references} billed line(s)`,
  ].join(' · ');

/** What MSP may have written on ERPNext Items, and the few values it can put back. */
export default function ItemIntegrityReview() {
  const navigate = useNavigate();
  const audit = useItemIntegrityAudit();
  const restore = useRestoreItemState();

  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<{ failed: number; restored: number } | null>(null);

  const rows = useMemo(() => audit.data?.rows ?? [], [audit.data]);
  const safe = useMemo(() => rows.filter((row) => row.group === SAFE), [rows]);
  const chosen = safe.filter((row) => picked.includes(row.item_code));

  const toggle = (item: string) =>
    setPicked((current) =>
      current.includes(item) ? current.filter((row) => row !== item) : [...current, item]
    );

  const apply = async () => {
    const out = await restore.mutateAsync(
      chosen.map((row) => ({
        item: row.item_code,
        fields: Object.fromEntries(
          Object.entries(row.restorable).map(([field, detail]) => [field, detail.current])
        ),
      }))
    );

    setOutcome({ failed: out.failed, restored: out.restored });
    setPicked([]);
    setConfirming(false);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/settings')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to settings
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50">
            <ShieldCheck size={20} className="text-blue-600" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Item integrity review</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Review Item changes detected around MSP catalogue and billing configuration. Nothing
              is changed until you select records and confirm the exact values to restore.
            </p>
          </div>
        </div>
      </div>

      {outcome && outcome.failed > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Some Item states could not be restored.
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            Successful changes were kept. Review the failed rows before trying again.
          </p>
        </div>
      )}

      {restore.error instanceof Error && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {restore.error.message}
        </p>
      )}

      {audit.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {audit.error instanceof Error && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {audit.error.message}
        </p>
      )}

      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group);

        return (
          <section key={group} className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">{group}</h2>
              <span className="text-xs font-medium text-slate-500">{groupRows.length}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    {group === SAFE && <th className="w-10 px-4 py-3" />}
                    {COLUMNS.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={COLUMNS.length + (group === SAFE ? 1 : 0)}
                        className="px-4 py-8 text-center text-sm text-slate-500"
                      >
                        Nothing here.
                      </td>
                    </tr>
                  )}
                  {groupRows.map((row) => (
                    <tr key={row.item_code} className="transition-colors hover:bg-slate-50">
                      {group === SAFE && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.item_code}`}
                            checked={picked.includes(row.item_code)}
                            onChange={() => toggle(row.item_code)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600"
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">{row.item_name || row.item_code}</p>
                        <p className="font-mono text-xs text-slate-500">{row.item_code}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{state(row)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{proven(row)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {row.evidence_level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{usage(row)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        {group === SAFE ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPicked([row.item_code]);
                              setConfirming(true);
                            }}
                            className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
                          >
                            Restore proven state
                          </button>
                        ) : (
                          <span className="text-slate-500">Review</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {group === SAFE && groupRows.length > 0 && (
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  disabled={chosen.length === 0 || restore.isLoading}
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Restore proven state
                </button>
              </div>
            )}
          </section>
        );
      })}

      <ConfirmModal
        open={confirming}
        title="Restore selected Item states?"
        description="Only the values shown below will be restored. MSP assignments, contracts, invoices and billing history will not be changed."
        confirmLabel="Restore selected values"
        loading={restore.isLoading}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
      >
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          {chosen.map((row) => (
            <li key={row.item_code}>
              <span className="font-semibold">{row.item_code}</span> · {proven(row)}
            </li>
          ))}
        </ul>
      </ConfirmModal>
    </div>
  );
}
