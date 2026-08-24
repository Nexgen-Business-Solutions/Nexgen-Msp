import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import TablePagination from './TablePagination';
export type KpiColumn = { key: string; label: string };
export type KpiRow = { name: string } & Record<string, string | number | null>;

export type KpiDetailPanelProps = {
  open: boolean;
  title: string;
  description?: string;
  columns: KpiColumn[];
  rows: KpiRow[];
  isLoading?: boolean;
  error?: unknown;
  emptyLabel?: string;
  start: number;
  pageLength: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onPageLengthChange: (pageLength: number) => void;
  onClose: () => void;
  onOpenRow?: (route: string) => void;
};

const statusBadge: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  'Pending Setup': 'bg-amber-100 text-amber-700',
  'Pending Removal': 'bg-orange-100 text-orange-700',
  Suspended: 'bg-orange-100 text-orange-700',
  Ended: 'bg-slate-100 text-slate-500',
  Cancelled: 'bg-slate-100 text-slate-500',
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  'Under Review': 'bg-indigo-100 text-indigo-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  'In Progress': 'bg-indigo-100 text-indigo-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-red-100 text-red-700',
  Retired: 'bg-slate-100 text-slate-500',
};

const isDateKey = (key: string) =>
  key === 'since' || key === 'created' || key === 'left_on';

const render = (column: KpiColumn, row: KpiRow) => {
  const value = row[column.key];

  if (value === null || value === undefined || value === '') return 'N/A';

  if (isDateKey(column.key)) return String(value).slice(0, 10);

  return String(value);
};

const KpiDetailPanel: React.FC<KpiDetailPanelProps> = ({
  open,
  title,
  description,
  columns,
  rows,
  isLoading = false,
  error,
  emptyLabel = 'Nothing to show here.',
  start,
  pageLength,
  total,
  onPrevious,
  onNext,
  onPageLengthChange,
  onClose,
  onOpenRow,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const columnCount = columns.length || 1;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={column.key}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === columns.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!!error && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-red-600">
                    {(error as Error)?.message || 'Failed to load data.'}
                  </td>
                </tr>
              )}

              {!error && isLoading && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!error && !isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-slate-500">
                    {emptyLabel}
                  </td>
                </tr>
              )}

              {!error &&
                !isLoading &&
                rows.map((row) => {
                  // every row here stands for something with a page of its own
                  const route = typeof row.route === 'string' ? row.route : null;
                  const openable = Boolean(route && onOpenRow);

                  return (
                  <tr
                    key={row.name}
                    onClick={() => openable && onOpenRow?.(route as string)}
                    className={`transition-colors hover:bg-slate-50 ${
                      openable ? 'cursor-pointer' : ''
                    }`}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className="whitespace-nowrap px-4 py-3">
                        {column.key === 'status' ? (
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              statusBadge[String(row[column.key])] || 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {String(row[column.key] ?? '').toUpperCase()}
                          </span>
                        ) : (
                          <span
                            className={`text-sm ${
                              column.key === 'user_name' ||
                              column.key === 'hostname' ||
                              column.key === 'request' ||
                              column.key === 'customer'
                                ? 'font-semibold text-slate-900'
                                : 'text-slate-600'
                            }`}
                          >
                            {render(column, row)}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <TablePagination
          start={start}
          pageLength={pageLength}
          total={total}
          loading={isLoading}
          onPrevious={onPrevious}
          onNext={onNext}
          onPageLengthChange={onPageLengthChange}
        />
      </aside>
    </div>
  );
};

export default KpiDetailPanel;
