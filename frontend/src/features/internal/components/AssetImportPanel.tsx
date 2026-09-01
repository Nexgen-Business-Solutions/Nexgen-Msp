import React, { useRef, useState } from 'react';
import { AlertCircle, FileUp, TriangleAlert } from 'lucide-react';
import type { AssetFileShape, AssetImportReport } from '@/lib/api/internal';
import { useRunAssetImport } from '../hooks/useSettings';

const LABELS: Record<string, string> = {
  hostname: 'Hostname',
  serial_number: 'Serial number',
  username: 'Username',
};

const SKIPPED: Record<string, string> = {
  no_hostname: 'no hostname on the row',
  unknown_hostname: 'hostname unknown here',
  ambiguous_hostname: 'hostname exists at several customers',
  nothing_to_write: 'neither serial nor username',
  already_filled: 'already recorded here, left alone',
  no_holder: 'machine held by nobody',
  serial_taken: 'serial already on another machine',
};

/**
 * The second sheet: a hostname, and the two facts we still lack about it. The hostname
 * says which machine takes the serial, and through its holder, who takes the username.
 */
const AssetImportPanel: React.FC = () => {
  const picker = useRef<HTMLInputElement>(null);
  const run = useRunAssetImport();

  const [file, setFile] = useState<File | null>(null);
  const [fillBlanksOnly, setFillBlanksOnly] = useState(true);
  const [shape, setShape] = useState<AssetFileShape | null>(null);
  const [report, setReport] = useState<AssetImportReport | null>(null);

  const start = async (dryRun: boolean) => {
    if (!file) return;
    setReport(null);
    const answer = await run.mutateAsync({ file, dryRun, fillBlanksOnly });
    setShape(answer.shape);
    setReport(answer.report);
  };

  const written = report ? Object.values(report.updated).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Serial numbers and usernames</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          The hostname says which machine takes the serial, and who takes the username. Column
          names need not be exact.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={picker}
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setShape(null);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileUp size={15} />
            {file ? file.name : 'Choose the file'}
          </button>
          <button
            type="button"
            disabled={!file || run.isLoading}
            onClick={() => start(true)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rehearse
          </button>
          <button
            type="button"
            disabled={!file || run.isLoading || !report?.dry_run}
            onClick={() => start(false)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import for real
          </button>
          {run.isLoading && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={fillBlanksOnly}
            onChange={(event) => setFillBlanksOnly(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">
            Only fill what is empty
            <span className="mt-0.5 block text-xs text-slate-400">
              Nothing recorded here is overwritten.
            </span>
          </span>
        </label>

        {run.error instanceof Error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{run.error.message}</span>
          </div>
        )}

        {shape && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Columns recognised
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries(LABELS).map(([key, label]) => (
                <span key={key} className="flex items-baseline gap-1.5">
                  <span className="text-slate-400">{label}</span>
                  <span
                    className={
                      shape.recognised[key as keyof typeof shape.recognised]
                        ? 'font-medium text-slate-700'
                        : 'font-medium text-amber-600'
                    }
                  >
                    {shape.recognised[key as keyof typeof shape.recognised] ?? 'not found'}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {report && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">
              {report.dry_run ? 'Rehearsal' : 'Imported'} — {report.rows_read} row(s) read,{' '}
              {written} value(s) {report.dry_run ? 'would be written' : 'written'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {report.updated.serial_numbers} serial number(s) · {report.updated.usernames}{' '}
              username(s)
            </p>

            {Object.entries(report.skipped).some(([, count]) => count > 0) && (
              <ul className="mt-3 space-y-0.5 text-sm text-slate-500">
                {Object.entries(report.skipped)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => (
                    <li key={key}>
                      {count} × {SKIPPED[key] ?? key}
                    </li>
                  ))}
              </ul>
            )}

            {report.exceptions.length > 0 && (
              <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  <TriangleAlert size={13} />
                  {report.exceptions.length} row(s) to look at
                </p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {report.exceptions.map((row, index) => (
                    <li key={index}>
                      <span className="font-semibold">Row {row.row}</span> — {row.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssetImportPanel;
