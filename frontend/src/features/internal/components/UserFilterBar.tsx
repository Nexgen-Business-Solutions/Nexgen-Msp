import React, { useState } from 'react';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import Select from '@/shared/components/Select';
import Modal from '@/shared/components/Modal';
import type { UserFilterOptions } from '@/lib/api/internal';
import type { UserFilterState } from '../hooks/useUsers';

type Props = {
  filters: UserFilterState;
  options?: UserFilterOptions;
  activeCount: number;
  onPatch: (changes: Partial<UserFilterState>) => void;
  onClear: () => void;
  onRefresh: () => void;
};

export const COVERAGE_LABELS: Record<string, string> = {
  no_device: 'No device',
  no_security: 'No endpoint protection',
  disabled_with_services: 'Disabled with open services',
};

const COVERAGE_OPTIONS = [
  { value: '', label: 'Any coverage' },
  { value: 'no_device', label: 'No device', description: 'Active users with no active device' },
  {
    value: 'no_security',
    label: 'No endpoint protection',
    description: 'Active users whose device has no security service',
  },
  {
    value: 'disabled_with_services',
    label: 'Disabled with open services',
    description: 'Offboarding never completed',
  },
];

const toOptions = (values: string[] = [], allLabel: string) => [
  { value: '', label: allLabel },
  ...values.map((value) => ({ value, label: value })),
];

const UserFilterBar: React.FC<Props> = ({
  filters,
  options,
  activeCount,
  onPatch,
  onClear,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<UserFilterState>(filters);

  const openModal = () => {
    setDraft(filters);
    setOpen(true);
  };

  const set = (patch: Partial<UserFilterState>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const apply = () => {
    onPatch({
      customer: draft.customer,
      status: draft.status,
      department: draft.department,
      service: draft.service,
      coverage: draft.coverage,
    });
    setOpen(false);
  };

  const serviceLabel = options?.services.find((item) => item.value === filters.service)?.label;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.customer)
    chips.push({
      key: 'customer',
      label: `Customer: ${filters.customer}`,
      onRemove: () => onPatch({ customer: '' }),
    });
  if (filters.status)
    chips.push({
      key: 'status',
      label: `Status: ${filters.status}`,
      onRemove: () => onPatch({ status: '' }),
    });
  if (filters.department)
    chips.push({
      key: 'dept',
      label: `Department: ${filters.department}`,
      onRemove: () => onPatch({ department: '' }),
    });
  if (filters.service)
    chips.push({
      key: 'service',
      label: `Service: ${serviceLabel ?? filters.service}`,
      onRemove: () => onPatch({ service: '' }),
    });
  if (filters.coverage)
    chips.push({
      key: 'coverage',
      label: COVERAGE_LABELS[filters.coverage] ?? filters.coverage,
      onRemove: () => onPatch({ coverage: '' }),
    });

  const ghost =
    'flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';

  return (
    <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(event) => onPatch({ search: event.target.value })}
            placeholder="Search name, department or hostname…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <button type="button" onClick={openModal} className={ghost}>
          <SlidersHorizontal size={16} />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-700">
              {activeCount}
            </span>
          )}
        </button>

        <button type="button" onClick={onRefresh} className={ghost}>
          <RefreshCw size={16} />
          <span className="hidden lg:inline">Refresh</span>
        </button>
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
        title="Filters"
        subtitle="Narrow the user register."
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                set({ customer: '', status: '', department: '', service: '', coverage: '' })
              }
              className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={apply}
              className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Customer"
            value={draft.customer}
            onChange={(value) => set({ customer: value })}
            options={toOptions(options?.customers, 'All customers')}
            className="min-w-0"
          />
          <Select
            label="Status"
            value={draft.status}
            onChange={(value) => set({ status: value })}
            options={toOptions(options?.statuses, 'All statuses')}
            className="min-w-0"
          />
          <Select
            label="Department"
            value={draft.department}
            onChange={(value) => set({ department: value })}
            options={toOptions(options?.departments, 'All departments')}
            className="min-w-0"
          />
          <Select
            label="Subscribed service"
            value={draft.service}
            onChange={(value) => set({ service: value })}
            options={[
              { value: '', label: 'Any service' },
              ...(options?.services ?? []).map((item) => ({
                value: item.value,
                label: item.label,
              })),
            ]}
            className="min-w-0"
          />
          <Select
            label="Coverage"
            value={draft.coverage}
            onChange={(value) => set({ coverage: value })}
            options={COVERAGE_OPTIONS}
            className="min-w-0"
          />
        </div>
      </Modal>
    </div>
  );
};

export default UserFilterBar;
