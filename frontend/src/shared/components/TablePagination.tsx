import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Select from './Select';

export type TablePaginationProps = {
  start: number;
  pageLength: number;
  total: number;
  loading?: boolean;
  pageLengthOptions?: number[];
  onPrevious?: () => void;
  onNext?: () => void;
  onPageLengthChange?: (pageLength: number) => void;
};

const TablePagination: React.FC<TablePaginationProps> = ({
  start,
  pageLength,
  total,
  loading = false,
  pageLengthOptions = [10, 20, 50, 100],
  onPrevious,
  onNext,
  onPageLengthChange,
}) => {
  const page = Math.floor(start / pageLength) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageLength));
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageLength, total);

  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-500">
          {total === 0 ? (
            'No entries'
          ) : (
            <>
              <span className="font-semibold text-slate-700 tabular-nums">{from}</span>
              <span className="text-slate-400">–</span>
              <span className="font-semibold text-slate-700 tabular-nums">{to}</span>
              <span className="text-slate-400"> of </span>
              <span className="font-semibold text-slate-700 tabular-nums">{total}</span>
            </>
          )}
        </p>

        {onPageLengthChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Rows</span>
            <Select
              className="w-20"
              value={String(pageLength)}
              onChange={(value) => onPageLengthChange(Number(value))}
              options={pageLengthOptions.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">
          {loading ? (
            'Loading…'
          ) : (
            <>
              Page <span className="font-semibold text-slate-700 tabular-nums">{page}</span>
              <span className="text-slate-400"> of </span>
              <span className="font-semibold text-slate-700 tabular-nums">{totalPages}</span>
            </>
          )}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={atStart || loading}
            onClick={onPrevious}
            aria-label="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 disabled:hover:bg-white"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            disabled={atEnd || loading}
            onClick={onNext}
            aria-label="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 disabled:hover:bg-white"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TablePagination;
