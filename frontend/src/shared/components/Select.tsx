import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAnchoredDropdown } from '@/shared/hooks/useAnchoredDropdown';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  className?: string;
  openDirection?: 'up' | 'down';
  searchable?: boolean;
}

// past a handful of entries, scrolling to find one stops being reasonable
const SEARCH_THRESHOLD = 8;

const Select: React.FC<Props> = ({
  value,
  onChange,
  options,
  label,
  placeholder,
  className,
  openDirection = 'down',
  searchable,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  const { anchorRef, panelRef, panelStyle } = useAnchoredDropdown(open, close, openDirection);

  const selected = options.find((option) => option.value === value);
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;

    return options.filter((option) =>
      `${option.label} ${option.description ?? ''}`.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div ref={anchorRef} className={`relative ${className ?? 'min-w-[12rem]'}`}>
      <button
        type="button"
        title={selected?.label ?? undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left transition-colors hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
      >
        <span className="min-w-0">
          {label && <span className="block text-[11px] font-medium text-slate-500">{label}</span>}
          <span
            className={`block truncate text-sm font-medium ${
              selected ? 'text-slate-700' : 'text-slate-400'
            }`}
          >
            {selected?.label ?? placeholder ?? 'Select…'}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={panelStyle}
            className="z-[200] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          >
            {withSearch && (
              <div className="sticky top-0 -mx-1 -mt-1 mb-1 border-b border-slate-100 bg-white px-2 pb-2 pt-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search…"
                    className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {shown.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches.</p>
            )}

            {shown.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(option.value)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-blue-50 font-semibold text-blue-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block">{option.label}</span>
                    {option.description && (
                      <span
                        className={`mt-0.5 block text-xs font-normal leading-snug ${
                          isSelected ? 'text-blue-600/80' : 'text-slate-500'
                        }`}
                      >
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check size={15} className="mt-0.5 shrink-0 text-blue-600" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};

export default Select;
