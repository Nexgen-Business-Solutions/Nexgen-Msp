import React, { useEffect, useState } from 'react';
import { Columns3, Download, RotateCcw } from 'lucide-react';
import Modal from './Modal';
import {
  defaultChoice,
  loadChoice,
  ordered,
  saveChoice,
  sectionsOf,
  type ExportCatalogue,
  type ExportChoice,
} from '../exportColumns';

type Props = {
  open: boolean;
  catalogue: ExportCatalogue;
  /** what the sheet takes away, or what the list shows */
  mode?: 'export' | 'listing';
  onClose: () => void;
  /** An export fetches the file here; the picker waits for it before it closes. */
  onConfirm: (choice: ExportChoice) => void | Promise<unknown>;
};

const tick =
  'h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 disabled:opacity-60';

/** Which columns an export carries, or which columns a list shows. */
const ColumnsModal: React.FC<Props> = ({ open, catalogue, mode = 'export', onClose, onConfirm }) => {
  const listing = mode === 'listing';
  const [choice, setChoice] = useState<ExportChoice>(() => defaultChoice(catalogue));
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setChoice(loadChoice(catalogue));
    setWorking(false);
    setFailed(null);
  }, [open, catalogue]);

  const limit = catalogue.limit;
  const full = Boolean(limit) && choice.columns.length >= (limit ?? 0);

  const toggle = (key: string) =>
    setChoice((current) => {
      const picked = current.columns.includes(key);

      // a list has room for so many columns; one more has to wait for one less
      if (!picked && limit && current.columns.length >= limit) return current;

      return {
        ...current,
        columns: ordered(
          catalogue,
          picked ? current.columns.filter((row) => row !== key) : [...current.columns, key]
        ),
      };
    });

  const toggleService = (key: string) =>
    setChoice((current) => ({
      ...current,
      serviceColumns: (catalogue.serviceFields ?? [])
        .map((field) => field.key)
        .filter((field) =>
          current.serviceColumns.includes(key)
            ? current.serviceColumns.includes(field) && field !== key
            : current.serviceColumns.includes(field) || field === key
        ),
    }));

  // an export is built on the server: the picker stays put, and says so, until the file is here
  const start = async () => {
    setWorking(true);
    setFailed(null);

    try {
      await onConfirm(choice);
      saveChoice(catalogue, choice);
      onClose();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'The export did not come through.');
    } finally {
      setWorking(false);
    }
  };

  const leave = () => {
    if (!working) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={leave}
      icon={Columns3}
      tone="blue"
      title={listing ? 'Columns to show' : 'Columns to export'}
      subtitle={
        listing
          ? `Pick up to ${limit} columns for this list. Your choice is kept for next time.`
          : 'Pick what the sheet carries. Your choice is kept for the next export.'
      }
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setChoice(defaultChoice(catalogue))}
            disabled={working}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-50"
          >
            <RotateCcw size={15} />
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            {limit && (
              <span
                className={`text-xs font-medium ${full ? 'text-amber-700' : 'text-slate-500'}`}
                aria-live="polite"
              >
                {choice.columns.length} of {limit} selected
              </span>
            )}
            <button
              type="button"
              onClick={leave}
              disabled={working}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={start}
              disabled={working}
              className="inline-flex min-w-[9rem] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {working ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Preparing…
                </>
              ) : listing ? (
                'Apply'
              ) : (
                <>
                  <Download size={15} />
                  Export
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      {failed && (
        <p className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {failed}
        </p>
      )}

      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        {sectionsOf(catalogue.columns).map((section) => (
          <div key={section} role="group" aria-label={section}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {section}
            </p>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-2">
              {catalogue.columns
                .filter((column) => column.section === section)
                .map((column) => {
                  const checked = column.required || choice.columns.includes(column.key);
                  const locked = column.required || (full && !checked);

                  return (
                    <label
                      key={column.key}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                        locked ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className={tick}
                        checked={checked}
                        disabled={locked}
                        onChange={() => !column.required && toggle(column.key)}
                      />
                      <span className={`text-sm ${locked && !checked ? 'text-slate-400' : 'text-slate-700'}`}>
                        {column.label}
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}

        {!listing && catalogue.serviceFields && (
          <div role="group" aria-label="Per service">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Per service
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Every service gets its own columns, side by side, under its own name. Pick what
              each of them says.
            </p>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-2">
              {catalogue.serviceFields.map((field) => (
                <label
                  key={field.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className={tick}
                    checked={choice.serviceColumns.includes(field.key)}
                    onChange={() => toggleService(field.key)}
                  />
                  <span className="text-sm text-slate-700">{field.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ColumnsModal;
