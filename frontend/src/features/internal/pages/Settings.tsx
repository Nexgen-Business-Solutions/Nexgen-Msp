import { useState } from 'react';
import {
  Building2,
  CircleAlert,
  FileText,
  Globe,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import DepartmentModal from '../components/DepartmentModal';
import InvoiceSettingsForm from '../components/InvoiceSettingsForm';
import PortalSettingsForm from '../components/PortalSettingsForm';
import AssetImportPanel from '../components/AssetImportPanel';
import UserImportPanel from '../components/UserImportPanel';
import type { DepartmentRow } from '@/lib/api/internal';
import {
  useDeleteDepartment,
  useDepartmentList,
  useDisableDepartment,
} from '../hooks/useSettings';

/** Sections are declared here so adding a new area of settings stays a one-liner. */
const SECTIONS = [
{
    id: 'portal',
    label: 'Portal',
    icon: Globe,
    blurb: 'What customer accounts are given when they sign in.',
  },
{
    id: 'departments',
    label: 'Departments',
    icon: Building2,
    blurb: 'Manage the department list. Most are shared; a few can belong to one customer.',
  },
{
    id: 'import',
    icon: Upload,
    label: 'Import',
    blurb: 'Rehearse first — nothing is written until you say so.',
  },
{
    id: 'invoice',
    label: 'Invoice',
    icon: FileText,
    blurb: 'The issuer block and the wire details printed on every invoice.',
  },
];

const DEPARTMENT_COLUMNS = ['Department', 'Description', 'Order', 'Used by', 'Status', ''];

/** Hairline header cell; the first and last line up with the panel's edge. */
const thClass = (index: number) =>
  `whitespace-nowrap border-b border-slate-200 bg-white py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
    index === 0 ? 'pl-5 pr-4 sm:pl-6' : index === DEPARTMENT_COLUMNS.length - 1 ? 'pl-4 pr-5 sm:pr-6' : 'px-4'
  }`;

/** One calm line in an empty or failed table, with an icon in a soft circle. */
const TableNote = ({
  icon: Icon,
  tone = 'slate',
  children,
}: {
  icon?: LucideIcon;
  tone?: 'slate' | 'red';
  children: React.ReactNode;
}) => (
  <tr>
    <td colSpan={DEPARTMENT_COLUMNS.length} className="px-4 py-12">
      <div
        className={`flex items-center justify-center gap-3 text-sm ${
          tone === 'red' ? 'text-red-600' : 'text-slate-500'
        }`}
      >
        {Icon && (
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-full ring-1 ${
              tone === 'red'
                ? 'bg-red-50 text-red-600 ring-red-100'
                : 'bg-slate-50 text-slate-400 ring-slate-200'
            }`}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
        )}
        {children}
      </div>
    </td>
  </tr>
);

export default function Settings() {
  const [section, setSection] = useState(SECTIONS[0].id);

  const departments = useDepartmentList(false);
  const disableDepartment = useDisableDepartment();
  const removeDepartment = useDeleteDepartment();

  const [editingDepartment, setEditingDepartment] = useState<DepartmentRow | null>(null);
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [deletingDepartment, setDeletingDepartment] = useState<DepartmentRow | null>(null);
  const [departmentDeleteError, setDepartmentDeleteError] = useState<string | null>(null);

  const departmentRows = departments.data ?? [];
  const current = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-5 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <nav aria-label="Settings sections" className="grid grid-cols-2 gap-1.5 lg:sticky lg:top-5 lg:grid-cols-1">
          {SECTIONS.map((entry) => {
            const Icon = entry.icon;
            const active = entry.id === section;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSection(entry.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active
                    ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200/70'
                    : 'font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ${
                    active
                      ? 'bg-blue-50 text-blue-600 ring-blue-100'
                      : 'bg-slate-50 text-slate-400 ring-slate-200/70'
                  }`}
                >
                  <Icon size={16} />
                </span>
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{current.label}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{current.blurb}</p>
          </div>
          {section === 'departments' && (
            <button
              type="button"
              onClick={() => {
                setEditingDepartment(null);
                setDepartmentModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              <Plus size={15} />
              Add department
            </button>
          )}
        </div>

        {section === 'invoice' && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
            <InvoiceSettingsForm />
          </div>
        )}

        {section === 'portal' && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
            <PortalSettingsForm />
          </div>
        )}

        {section === 'import' && (
          <div className="space-y-6">
            <UserImportPanel />
            <AssetImportPanel />
          </div>
        )}

        {section === 'departments' && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5 sm:px-6">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">Department list</h3>
              {!departments.isLoading && (
                <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-slate-200">
                  {departmentRows.length}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">Disable one that is in use; delete only one nobody ever used.</p>
          </div>
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
                <tr>
                  {DEPARTMENT_COLUMNS.map((column, index) => (
                    <th key={column || index} className={thClass(index)}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.isLoading && <TableNote>Loading…</TableNote>}

                {departments.error instanceof Error && (
                  <TableNote icon={CircleAlert} tone="red">
                    {departments.error.message}
                  </TableNote>
                )}

                {!departments.isLoading && departmentRows.length === 0 && (
                  <TableNote icon={Building2}>
                    No departments yet. Add one so users can select it in forms.
                  </TableNote>
                )}

                {departmentRows.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50/80">
                    <td className="whitespace-nowrap py-3 pl-5 pr-4 text-sm font-semibold text-slate-900 sm:pl-6">
                      {row.department_name}
                      <p className="text-xs font-normal text-slate-500">
                        {row.customer ? `Only for ${row.customer}` : 'All customers'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.description || '—'}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-slate-600">
                      {row.sort_order ?? 'Automatic'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.used ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Users size={14} className="shrink-0 text-slate-400" aria-hidden />
                          <span>
                            {row.users} user{row.users === 1 ? '' : 's'}
                            {row.approvers ? `, ${row.approvers} approver` : ''}
                            {row.approvers && row.approvers > 1 ? 's' : ''}
                            {row.open_requests ? `, ${row.open_requests} open request` : ''}
                            {row.open_requests && row.open_requests > 1 ? 's' : ''}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Nobody yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          row.enabled
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-slate-50 text-slate-500 ring-slate-200'
                        }`}
                      >
                        {row.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pl-4 pr-5 sm:pr-6">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'Edit department',
                              icon: Pencil,
                              onClick: () => {
                                setEditingDepartment(row);
                                setDepartmentModalOpen(true);
                              },
                            },
                            {
                              label: 'Disable department',
                              icon: Building2,
                              disabled: !row.enabled,
                              onClick: () => disableDepartment.mutate(row.name),
                            },
                            {
                              label: 'Delete department',
                              icon: Trash2,
                              danger: true,
                              onClick: () => {
                                setDepartmentDeleteError(null);
                                setDeletingDepartment(row);
                              },
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
        </div>
        )}
      </div>

      <DepartmentModal
        open={departmentModalOpen}
        department={editingDepartment}
        onClose={() => setDepartmentModalOpen(false)}
      />

      <ConfirmModal
        open={Boolean(deletingDepartment)}
        tone="danger"
        title="Delete this department?"
        description="You can delete this department only if it has never been used. Otherwise, disable it to keep existing records accurate."
        confirmLabel="Delete"
        loading={removeDepartment.isLoading}
        error={departmentDeleteError}
        onCancel={() => {
          setDeletingDepartment(null);
          setDepartmentDeleteError(null);
        }}
        onConfirm={async () => {
          try {
            await removeDepartment.mutateAsync(deletingDepartment?.name as string);
            setDeletingDepartment(null);
            setDepartmentDeleteError(null);
          } catch (error) {
            setDepartmentDeleteError(
              error instanceof Error ? error.message : 'Could not delete this department.'
            );
          }
        }}
      />
    </div>
  );
}
