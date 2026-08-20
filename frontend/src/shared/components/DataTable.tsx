import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Select from './Select';
import TablePagination from './TablePagination';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

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
  start?: number;
  pageLength?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onPageLengthChange?: (pageLength: number) => void;
  search?: string;
  onSearchChange?: (search: string) => void;
  status?: string;
  onStatusChange?: (status: string) => void;
  action?: { label: string; icon?: LucideIcon; onClick: () => void };
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
  start = 0,
  pageLength = 20,
  total = 0,
  onPrevious,
  onNext,
  onPageLengthChange,
  search = '',
  onSearchChange,
  status = '',
  onStatusChange,
  action,
  children,
}) => {
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebouncedValue(searchInput);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (!onSearchChange) return;
    if (debouncedSearch === search) return;
    onSearchChange(debouncedSearch);
  }, [debouncedSearch, onSearchChange, search]);

  return (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-md">
    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {action && !showToolbar && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          {action.icon && <action.icon size={14} />}
          {action.label}
        </button>
      )}
      {showToolbar && (
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 w-64 rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <Select
            value={status}
            onChange={(value) => onStatusChange?.(value)}
            className="w-48"
            options={[
              { value: '', label: 'All statuses' },
              ...statuses.map((status) => ({ value: status, label: status })),
            ]}
          />
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              {action.icon && <action.icon size={15} />}
              {action.label}
            </button>
          )}
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
      <TablePagination
        start={start}
        pageLength={pageLength}
        total={total}
        loading={isLoading}
        onPrevious={onPrevious}
        onNext={onNext}
        onPageLengthChange={onPageLengthChange}
      />
    )}
  </div>
  );
};

export default DataTable;
