import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  CircleCheck,
  FileUp,
  Plus,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import Select from '@/shared/components/Select';
import type { CustomerMapping, ImportReport, ServiceMapping } from '@/lib/api/internal';
import {
  useImportMappings,
  useRunUserImport,
  useSaveImportMappings,
} from '../hooks/useSettings';

const inputClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
    {children}
  </th>
);

const Accordion = ({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            {badge}
          </span>
          <span className="mt-0.5 block text-sm text-slate-400">{hint}</span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-4">{children}</div>}
    </div>
  );
};

const Counters = ({ title, values }: { title: string; values: Record<string, number> }) => {
  const entries = Object.entries(values).filter(([, count]) => count > 0);

  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([key, count]) => (
          <span key={key} className="text-sm text-slate-700">
            <span className="font-semibold tabular-nums">{count}</span> {key.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
};

const UserImportPanel: React.FC = () => {
  const mappings = useImportMappings();
  const save = useSaveImportMappings();
  const run = useRunUserImport();
  // the application has been running: what someone corrected here outranks the sheet
  const [fillBlanksOnly, setFillBlanksOnly] = useState(true);

  const [customers, setCustomers] = useState<CustomerMapping[]>([]);
  const [services, setServices] = useState<ServiceMapping[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dirty, setDirty] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mappings.data) return;
    setCustomers(mappings.data.customers);
    setServices(mappings.data.services);
    setDirty(false);
  }, [mappings.data]);

  const patchCustomer = (index: number, changes: Partial<CustomerMapping>) => {
    setCustomers((rows) => rows.map((row, at) => (at === index ? { ...row, ...changes } : row)));
    setDirty(true);
  };

  const patchService = (index: number, changes: Partial<ServiceMapping>) => {
    setServices((rows) => rows.map((row, at) => (at === index ? { ...row, ...changes } : row)));
    setDirty(true);
  };

  const start = async (dryRun: boolean) => {
    if (!file) return;
    setReport(null);
    setReport(await run.mutateAsync({ file, dryRun, fillBlanksOnly }));
  };

  const unresolved = customers.filter((row) => row.exists === false && !row.create_as);
  const missingItems = services.filter((row) => row.exists === false);

  const warningBadge = (count: number) =>
    count > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <TriangleAlert size={11} />
        {count}
      </span>
    ) : null;

  return (
    <div className="space-y-6 px-5 pb-6">
      <div>
        <p className="text-sm text-slate-500">
          Drop the user list and run the rehearsal: it reports what would happen without writing
          anything. Nothing is ever created twice — a person already on file is updated, never
          duplicated.
        </p>

        {(unresolved.length > 0 || missingItems.length > 0) && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              {unresolved.length > 0 && (
                <>
                  {unresolved.map((row) => row.excel_label).join(', ')} point at a customer that
                  does not exist here, so their rows will be rejected.{' '}
                </>
              )}
              {missingItems.length > 0 && (
                <>
                  {missingItems.map((row) => row.service_key).join(', ')} point at an article that
                  does not exist here, so nothing will be assigned for them.{' '}
                </>
              )}
              Open the mapping below to fix it.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={picker}
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
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
              On, the sheet fills gaps and never overwrites: a field already recorded here, a
              device already handed to someone, and the billing dates all stay as they are.
              Off, the sheet restates the billing dates and gives every device back to the
              holder it names.
            </span>
          </span>
        </label>

        {run.error instanceof Error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{run.error.message}</span>
          </div>
        )}

        {report && (
          <div className="mt-4 space-y-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {report.dry_run ? 'Rehearsal' : 'Imported'} — {report.rows_read} row(s) read
              {report.dry_run && (
                <span className="ml-2 font-normal text-slate-500">nothing was written</span>
              )}
            </p>
            <Counters title="Created" values={report.created} />
            <Counters title="Updated" values={report.updated} />
            <Counters title="Skipped" values={report.skipped} />

            {report.exceptions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Rows needing attention ({report.exceptions.length})
                </p>
                <div className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full">
                    <tbody className="divide-y divide-slate-100">
                      {report.exceptions.map((row, index) => (
                        <tr key={index}>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                            {row.row ? `Row ${row.row}` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-700">
                            {row.name ?? ''}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-600">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-5">
        <Accordion
          title="Companies"
          hint="Which customer each company in the file already is here."
          badge={warningBadge(unresolved.length)}
        >
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  <Th>Company in file</Th>
                  <Th>Customer id</Th>
                  <Th>Create if missing</Th>
                  <Th>Department prefix</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((row, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.excel_label}
                        onChange={(event) =>
                          patchCustomer(index, { excel_label: event.target.value })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.customer_id}
                        onChange={(event) =>
                          patchCustomer(index, { customer_id: event.target.value })
                        }
                        className={inputClass}
                      />
                      {row.exists === false && !row.create_as && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <TriangleAlert size={12} />
                          No such customer here
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.create_as ?? ''}
                        placeholder="Leave empty to reject"
                        onChange={(event) => patchCustomer(index, { create_as: event.target.value })}
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.department_prefix ?? ''}
                        placeholder="For a sub-account"
                        onChange={(event) =>
                          patchCustomer(index, { department_prefix: event.target.value })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomers((rows) => rows.filter((_, at) => at !== index));
                          setDirty(true);
                        }}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => {
              setCustomers((rows) => [
                ...rows,
                { excel_label: '', customer_id: '', create_as: '', department_prefix: '' },
              ]);
              setDirty(true);
            }}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
          >
            <Plus size={14} />
            Add a company
          </button>
        </Accordion>

        <Accordion
          title="Services"
          hint="Which article each service column bills against."
          badge={warningBadge(missingItems.length)}
        >
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full sm:max-w-3xl">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  <Th>Service in file</Th>
                  <Th>Item id</Th>
                  <Th>Attached to</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {services.map((row, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2 text-sm font-semibold text-slate-900">
                      {row.service_key}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.item_id}
                        onChange={(event) => patchService(index, { item_id: event.target.value })}
                        className={inputClass}
                      />
                      {row.exists === false && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <TriangleAlert size={12} />
                          No such item here
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        className="w-full"
                        value={row.scope}
                        onChange={(value) => patchService(index, { scope: value })}
                        options={[
                          { value: 'User', label: 'User' },
                          { value: 'Device', label: 'Device' },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}

        {(dirty || save.isSuccess) && (
          <div className="flex items-center justify-end gap-3">
            {!dirty && save.isSuccess && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                <CircleCheck size={15} />
                Saved
              </span>
            )}
            {dirty && (
              <button
                type="button"
                disabled={save.isLoading}
                onClick={() => save.mutate({ customers, services })}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save the mapping
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserImportPanel;
