import React from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

export type DataTableProps = {
  title: string;
  columns: string[];
  rowCount: number;
  isLoading?: boolean;
  error?: unknown;
  emptyLabel?: string;
  searchPlaceholder?: string;
  statuses?: string[];
  showToolbar?: boolean;
  showPagination?: boolean;
  from?: number;
  to?: number;
  total?: number;
  page?: number;
  totalPages?: number;
  children: React.ReactNode;
};

const DataTable: React.FC<DataTableProps> = ({
  title,
  columns,
  rowCount,
  isLoading = false,
  error,
  emptyLabel = 'No records found.',
  searchPlaceholder = 'Search…',
  statuses = [],
  showToolbar = true,
  showPagination = true,
  from = 0,
  to = 0,
  total = 0,
  page = 1,
  totalPages = 1,
  children,
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-md">
    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {showToolbar && (
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className="h-10 w-64 rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <select className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100">
            {['', ...statuses].map((opt) => (
              <option key={opt || 'all'} value={opt}>
                {opt || 'All statuses'}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>

    <div className="overflow-x-auto px-5 pb-1">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col, index) => (
              <th
                key={col}
                className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                  index === 0 ? 'rounded-l-lg' : ''
                } ${index === columns.length - 1 ? 'rounded-r-lg' : ''}`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {!!error && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-red-600">
                {(error as Error)?.message || 'Failed to load data.'}
              </td>
            </tr>
          )}

          {!error && isLoading && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500">
                Loading…
              </td>
            </tr>
          )}

          {!error && !isLoading && rowCount === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          )}

          {!error && !isLoading && children}
        </tbody>
      </table>
    </div>

    {showPagination && (
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
        <span className="text-sm text-slate-500">
          Showing {from} to {to} of {total} entries
        </span>
        <div className="flex items-center gap-1.5">
          <button
            disabled={page <= 1}
            aria-label="Previous page"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            disabled={page >= totalPages}
            aria-label="Next page"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    )}
  </div>
);

export default DataTable;
