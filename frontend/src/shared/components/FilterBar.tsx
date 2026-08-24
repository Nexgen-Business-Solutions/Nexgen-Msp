import React, { useState } from 'react';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import Select, { type SelectOption } from './Select';
import MultiSelect from './MultiSelect';
import Modal from './Modal';

export type FilterValue = string | string[] | undefined;

export type FilterField =
  | {
      key: string;
      label: string;
      kind: 'select';
      options: SelectOption[];
      allLabel?: string;
      /** What "no filter" means for this axis, when it is not the empty string. */
      clearValue?: string;
    }
  | {
      key: string;
      label: string;
      kind: 'multiselect';
      options: SelectOption[];
      placeholder?: string;
    }
  | {
      key: string;
      label: string;
      kind: 'daterange';
      fromKey: string;
      toKey: string;
    };

export type FilterState = Record<string, FilterValue>;

type Props = {
  values: FilterState;
  fields: FilterField[];
  search: string;
  searchPlaceholder?: string;
  title?: string;
  subtitle?: string;
  onSearch: (value: string) => void;
  onApply: (values: FilterState) => void;
  onClear: () => void;
  onRefresh?: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const ghost =
  'flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';

const clearValueOf = (field?: FilterField) =>
  field && field.kind === 'select' ? (field.clearValue ?? '') : '';

const isSet = (value: FilterValue, field?: FilterField) =>
  Array.isArray(value) ? value.length > 0 : Boolean(value) && value !== clearValueOf(field);

const labelFor = (options: SelectOption[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

/**
 * The filter pattern used across every listing: a search box, a Filters dialog holding the
 * narrower axes, and a row of chips showing what is currently applied.
 */
const FilterBar: React.FC<Props> = ({
  values,
  fields,
  search,
  searchPlaceholder = 'Search…',
  title = 'Filters',
  subtitle,
  onSearch,
  onApply,
  onClear,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterState>(values);

  const openModal = () => {
    setDraft(values);
    setOpen(true);
  };

  const set = (patch: FilterState) => setDraft((current) => ({ ...current, ...patch }));

  const keysOf = (field: FilterField) =>
    field.kind === 'daterange' ? [field.fromKey, field.toKey] : [field.key];

  const fieldOf = (key: string) => fields.find((entry) => keysOf(entry).includes(key));

  const allKeys = fields.flatMap(keysOf);
  const activeCount = allKeys.filter((key) => isSet(values[key], fieldOf(key))).length;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  for (const field of fields) {
    if (field.kind === 'daterange') {
      const from = values[field.fromKey] as string | undefined;
      const to = values[field.toKey] as string | undefined;

      if (from || to) {
        chips.push({
          key: field.key,
          label: `${field.label}: ${from || '…'} → ${to || '…'}`,
          onRemove: () => onApply({ ...values, [field.fromKey]: '', [field.toKey]: '' }),
        });
      }
      continue;
    }

    const value = values[field.key];
    if (!isSet(value, field)) continue;

    if (field.kind === 'multiselect') {
      for (const entry of value as string[]) {
        chips.push({
          key: `${field.key}-${entry}`,
          label: `${field.label}: ${labelFor(field.options, entry)}`,
          onRemove: () =>
            onApply({
              ...values,
              [field.key]: (value as string[]).filter((item) => item !== entry),
            }),
        });
      }
      continue;
    }

    chips.push({
      key: field.key,
      label: `${field.label}: ${labelFor(field.options, value as string)}`,
      onRemove: () => onApply({ ...values, [field.key]: clearValueOf(field) }),
    });
  }

  const cleared = () =>
    allKeys.reduce<FilterState>((acc, key) => {
      const field = fieldOf(key);
      acc[key] = field?.kind === 'multiselect' ? [] : clearValueOf(field);
      return acc;
    }, {});

  return (
    <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {fields.length > 0 && (
          <button type="button" onClick={openModal} className={ghost}>
            <SlidersHorizontal size={16} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-700">
                {activeCount}
              </span>
            )}
          </button>
        )}

        {onRefresh && (
          <button type="button" onClick={onRefresh} className={ghost}>
            <RefreshCw size={16} />
            <span className="hidden lg:inline">Refresh</span>
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 py-1 pl-3 pr-2 text-xs font-medium text-blue-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
          >
            Clear all
          </button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon={SlidersHorizontal}
        tone="slate"
        title={title}
        subtitle={subtitle}
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setDraft(cleared())}
              className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => {
            if (field.kind === 'daterange') {
              return (
                <div key={field.key} className="sm:col-span-2">
                  <p className="mb-1.5 text-[11px] font-medium text-slate-500">{field.label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={(draft[field.fromKey] as string) ?? ''}
                      max={(draft[field.toKey] as string) || undefined}
                      onChange={(event) => set({ [field.fromKey]: event.target.value })}
                      className={inputClass}
                    />
                    <span className="text-sm text-slate-400">→</span>
                    <input
                      type="date"
                      value={(draft[field.toKey] as string) ?? ''}
                      min={(draft[field.fromKey] as string) || undefined}
                      onChange={(event) => set({ [field.toKey]: event.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              );
            }

            if (field.kind === 'multiselect') {
              return (
                <div key={field.key} className="min-w-0">
                  <p className="mb-1.5 text-[11px] font-medium text-slate-500">{field.label}</p>
                  <MultiSelect
                    searchable
                    values={(draft[field.key] as string[]) ?? []}
                    onChange={(next) => set({ [field.key]: next })}
                    options={field.options}
                    placeholder={field.placeholder ?? `Any ${field.label.toLowerCase()}`}
                  />
                </div>
              );
            }

            return (
              <Select
                key={field.key}
                searchable
                label={field.label}
                value={(draft[field.key] as string) ?? ''}
                onChange={(next) => set({ [field.key]: next })}
                options={
                  field.clearValue
                    ? field.options
                    : [
                        {
                          value: '',
                          label: field.allLabel ?? `All ${field.label.toLowerCase()}`,
                        },
                        ...field.options,
                      ]
                }
                className="min-w-0"
              />
            );
          })}
        </div>
      </Modal>
    </div>
  );
};

export default FilterBar;
