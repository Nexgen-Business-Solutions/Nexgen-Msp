import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { SelectOption } from './Select';
import { useAnchoredDropdown } from '@/shared/hooks/useAnchoredDropdown';

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  searchable?: boolean;
}

// past a handful of entries, scrolling to find one stops being reasonable
const SEARCH_THRESHOLD = 8;

const MultiSelect: React.FC<Props> = ({
  values,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  searchable,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  const { anchorRef, panelRef, panelStyle } = useAnchoredDropdown(open, close);

  const selected = options.filter((option) => values.includes(option.value));
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;

    return options.filter((option) =>
      `${option.label} ${option.description ?? ''}`.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  return (
    <div ref={anchorRef} className={`relative ${className ?? 'w-full'}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[2.5rem] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
      >
        <span className="flex flex-1 flex-wrap gap-1.5">
          {selected.length === 0 && <span className="text-sm text-slate-400">{placeholder}</span>}
          {selected.map((option) => (
            <span
              key={option.value}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 py-0.5 pl-2 pr-1 text-xs font-semibold text-blue-700"
            >
              {option.label}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${option.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(option.value);
                }}
                className="flex h-4 w-4 items-center justify-center rounded transition-colors hover:bg-blue-200"
              >
                <X size={11} />
              </span>
            </span>
          ))}
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
            aria-multiselectable
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
            const isSelected = values.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(option.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-50 font-semibold text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={15} className="shrink-0 text-blue-600" />}
              </button>
            );
          })}
          </div>,
          document.body
        )}
    </div>
  );
};

export default MultiSelect;
