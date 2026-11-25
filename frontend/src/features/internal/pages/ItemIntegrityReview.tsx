import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CircleCheck,
  Eye,
  MinusCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useItemIntegrityAudit, useRestoreItemState } from '../hooks/useSettings';
import type { ItemIntegrityRow } from '@/lib/api/internal';

const SAFE = 'Safe to restore';
const REVIEW = 'Needs review';
const LEAVE = 'No change recommended';

const GROUPS = [SAFE, REVIEW, LEAVE] as const;

/** How each group reads at a glance: its icon, the tile colour and one line on what it holds. */
const GROUP_LOOK: Record<(typeof GROUPS)[number], { icon: LucideIcon; tile: string; stat: string; note: string }> = {
  [SAFE]: {
    icon: RotateCcw,
    tile: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    stat: 'Can be put back',
    note: 'A previous state is proven, so it can be put back exactly.',
  },
  [REVIEW]: {
    icon: Eye,
    tile: 'bg-amber-50 text-amber-600 ring-amber-100',
    stat: 'Want a human look',
    note: 'The evidence is not conclusive. Check these in ERPNext before changing anything.',
  },
  [LEAVE]: {
    icon: MinusCircle,
    tile: 'bg-slate-100 text-slate-600 ring-slate-200',
    stat: 'Left as they are',
    note: 'Nothing points to a change MSP should undo.',
  },
};

const Th = ({ children, narrow = false }: { children?: React.ReactNode; narrow?: boolean }) => (
  <th
    className={`whitespace-nowrap border-b border-slate-200 bg-white px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6 ${
      narrow ? 'w-10' : ''
    }`}
  >
    {children}
  </th>
);

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

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
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/settings')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to settings
      </button>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100"
          >
            <ShieldCheck className="size-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Item integrity review</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Review Item changes detected around MSP catalogue and billing configuration. Nothing
              is changed until you select records and confirm the exact values to restore.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
          {GROUPS.map((group) => {
            const look = GROUP_LOOK[group];
            const Icon = look.icon;

            return (
              <div
                key={group}
                className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60"
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${look.tile}`}>
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-semibold leading-tight tabular-nums text-slate-900">
                    {audit.isLoading ? '—' : rows.filter((row) => row.group === group).length}
                  </p>
                  <p className="truncate text-[13px] text-slate-500">{look.stat}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {outcome && outcome.failed > 0 && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-amber-600 ring-1 ring-amber-200">
            <TriangleAlert className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Some Item states could not be restored.
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Successful changes were kept. Review the failed rows before trying again.
            </p>
          </div>
        </div>
      )}

      {restore.error instanceof Error && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          {restore.error.message}
        </p>
      )}

      {audit.isLoading && (
        <div className="flex items-center justify-center gap-3 p-6 text-sm text-slate-500">
          <span className="size-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
          <p>Loading…</p>
        </div>
      )}

      {audit.error instanceof Error && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          {audit.error.message}
        </p>
      )}

      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group);

        return (
          <section
            key={group}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900">{group}</h2>
                <p className="mt-0.5 text-sm text-slate-500">{GROUP_LOOK[group].note}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                {groupRows.length}
              </span>
            </div>

            <div className="overflow-x-auto pb-2">
              <table className="w-full">
                <thead className="bg-white">
                  <tr>
                    {group === SAFE && <Th narrow />}
                    {COLUMNS.map((column) => (
                      <Th key={column}>{column}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupRows.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length + (group === SAFE ? 1 : 0)} className="px-4 py-10">
                        <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                            <CircleCheck className="size-[18px]" strokeWidth={1.75} />
                          </span>
                          <span>Nothing here.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {groupRows.map((row) => (
                    <tr key={row.item_code} className="transition-colors hover:bg-slate-50/80">
                      {group === SAFE && (
                        <td className={td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.item_code}`}
                            checked={picked.includes(row.item_code)}
                            onChange={() => toggle(row.item_code)}
                            className="size-4 rounded border-slate-300 text-blue-600 accent-blue-500"
                          />
                        </td>
                      )}
                      <td className={`whitespace-nowrap ${td}`}>
                        <p className="text-sm font-semibold text-slate-900">{row.item_name || row.item_code}</p>
                        <p className="font-mono text-xs text-slate-500">{row.item_code}</p>
                      </td>
                      <td className={`${td} text-sm text-slate-600`}>{state(row)}</td>
                      <td className={`${td} text-sm text-slate-600`}>{proven(row)}</td>
                      <td className={`whitespace-nowrap ${td}`}>
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                          {row.evidence_level}
                        </span>
                      </td>
                      <td className={`${td} text-xs text-slate-500`}>{usage(row)}</td>
                      <td className={`whitespace-nowrap ${td} text-sm`}>
                        {group === SAFE ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPicked([row.item_code]);
                              setConfirming(true);
                            }}
                            className="font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
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
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
                <span className="text-sm text-slate-500">
                  <span className="tabular-nums">{chosen.length}</span> selected
                </span>
                <button
                  type="button"
                  disabled={chosen.length === 0 || restore.isLoading}
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw size={14} />
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
