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
  onClose: () => void;
  onExport: (choice: ExportChoice) => void;
};

const tick =
  'h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600 disabled:opacity-60';

/** Which columns the sheet comes out with, and what each service carries with it. */
const ExportColumnsModal: React.FC<Props> = ({ open, catalogue, onClose, onExport }) => {
  const [choice, setChoice] = useState<ExportChoice>(() => defaultChoice(catalogue));

  useEffect(() => {
    if (open) setChoice(loadChoice(catalogue));
  }, [open, catalogue]);

  const toggle = (key: string) =>
    setChoice((current) => ({
      ...current,
      columns: ordered(
        catalogue,
        current.columns.includes(key)
          ? current.columns.filter((row) => row !== key)
          : [...current.columns, key]
      ),
    }));

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

  const start = () => {
    saveChoice(catalogue, choice);
    onExport(choice);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Columns3}
      tone="blue"
      title="Columns to export"
      subtitle="Pick what the sheet carries. Your choice is kept for the next export."
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setChoice(defaultChoice(catalogue))}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            <RotateCcw size={15} />
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Download size={15} />
              Export
            </button>
          </div>
        </div>
      }
    >
      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        {sectionsOf(catalogue.columns).map((section) => (
          <div key={section} role="group" aria-label={section}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {section}
            </p>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-2">
              {catalogue.columns
                .filter((column) => column.section === section)
                .map((column) => (
                  <label
                    key={column.key}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                      column.required ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className={tick}
                      checked={column.required || choice.columns.includes(column.key)}
                      disabled={column.required}
                      onChange={() => !column.required && toggle(column.key)}
                    />
                    <span className="text-sm text-slate-700">{column.label}</span>
                  </label>
                ))}
            </div>
          </div>
        ))}

        {catalogue.serviceFields && (
          <div role="group" aria-label="Per service">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Per service
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Every service gets its own columns, side by side: Service 1, Service 2, and so on.
              Pick what each of them says.
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

export default ExportColumnsModal;
