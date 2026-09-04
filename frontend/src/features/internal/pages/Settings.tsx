import { useState } from 'react';
import { FileText, Globe, ListChecks, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import RequestActionModal from '../components/RequestActionModal';
import InvoiceSettingsForm from '../components/InvoiceSettingsForm';
import PortalSettingsForm from '../components/PortalSettingsForm';
import AssetImportPanel from '../components/AssetImportPanel';
import UserImportPanel from '../components/UserImportPanel';
import type { RequestActionRow } from '@/lib/api/internal';
import { useDeleteRequestAction, useRequestActionList } from '../hooks/useSettings';

/** Sections are declared here so adding a new area of settings stays a one-liner. */
const SECTIONS = [
  {
    id: 'invoice',
    label: 'Invoice',
    icon: FileText,
    blurb: 'The issuer block and the wire details printed on every invoice.',
  },
  {
    id: 'portal',
    label: 'Portal',
    icon: Globe,
    blurb: 'What customer accounts are given when they sign in.',
  },
  {
    id: 'import',
    icon: Upload,
    label: 'Import',
    blurb: 'Rehearse first — nothing is written until you say so.',
  },
  {
    id: 'request-actions',
    label: 'Request actions',
    icon: ListChecks,
    blurb: 'What a customer can ask for, and what each choice makes the engine do.',
  },
];

const COLUMNS = ['Title', 'Type', 'Description', 'Used', 'Offered', ''];

export default function Settings() {
  const [section, setSection] = useState(SECTIONS[0].id);
  const actions = useRequestActionList();
  const remove = useDeleteRequestAction();

  const [editing, setEditing] = useState<RequestActionRow | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<RequestActionRow | null>(null);

  const rows = actions.data ?? [];
  const current = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  return (
    <div className="flex flex-col gap-5 px-6 pb-6 pt-4 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <nav className="space-y-1">
          {SECTIONS.map((entry) => {
            const Icon = entry.icon;
            const active = entry.id === section;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSection(entry.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 font-semibold text-blue-700'
                    : 'font-medium text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={16} className={active ? 'text-blue-600' : 'text-slate-400'} />
                {entry.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{current.label}</h2>
              <p className="mt-0.5 text-sm text-slate-400">{current.blurb}</p>
            </div>
            {section === 'request-actions' && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus size={15} />
                New action
              </button>
            )}
          </div>

          {section === 'invoice' && <InvoiceSettingsForm />}

          {section === 'portal' && <PortalSettingsForm />}

          {section === 'import' && (
            <div className="space-y-5">
              <UserImportPanel />
              <AssetImportPanel />
            </div>
          )}

          {section === 'request-actions' && (
          <div className="max-h-[62vh] overflow-auto px-5 pb-4">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  {COLUMNS.map((column, index) => (
                    <th
                      key={column || index}
                      className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                        index === 0 ? 'rounded-l-lg' : ''
                      } ${index === COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {actions.isLoading && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      Loading…
                    </td>
                  </tr>
                )}

                {actions.error instanceof Error && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-4 py-12 text-center text-sm text-red-600"
                    >
                      {actions.error.message}
                    </td>
                  </tr>
                )}

                {!actions.isLoading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      No action defined — customers would have nothing to pick.
                    </td>
                  </tr>
                )}

                {rows.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {row.title}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={row.action_type} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.description || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                      {row.used}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          row.enabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {row.enabled ? 'OFFERED' : 'HIDDEN'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'Edit action',
                              icon: Pencil,
                              onClick: () => {
                                setEditing(row);
                                setOpen(true);
                              },
                            },
                            {
                              label: 'Delete action',
                              icon: Trash2,
                              danger: true,
                              disabled: row.used > 0,
                              onClick: () => setDeleting(row),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>

      <RequestActionModal open={open} action={editing} onClose={() => setOpen(false)} />

      <ConfirmModal
        open={Boolean(deleting)}
        tone="danger"
        title="Delete this action?"
        description="Customers will no longer be able to pick it. Nothing already requested is affected."
        confirmLabel="Delete"
        loading={remove.isLoading}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync(deleting?.name as string);
          setDeleting(null);
        }}
      />
    </div>
  );
}
