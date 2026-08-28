import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as internal from '@/lib/api/internal';
import { Eye, Laptop, Plus, ShieldAlert, UserMinus, Users } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import TablePagination from '@/shared/components/TablePagination';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import NewUserModal from '../components/NewUserModal';
import { useUserFilterOptions, useUserFilters, useUserList, useUserStats } from '../hooks/useUsers';

const COVERAGE_OPTIONS = [
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

const PORTAL_OPTIONS = [
  { value: 'yes', label: 'Has portal access', description: 'Can sign in to the customer portal' },
  { value: 'no', label: 'No portal access', description: 'Never invited, or access revoked' },
];

const COLUMNS = ['User', 'Department', 'Customer', 'Device', 'Active services', 'Inactive services', ''];

export default function UsersList() {
  const navigate = useNavigate();
  const [newUserOpen, setNewUserOpen] = useState(false);
  const { filters, patch, clear } = useUserFilters();
  const options = useUserFilterOptions();
  const statsParams = {
    search: filters.search || undefined,
    customer: filters.customer || undefined,
    status: filters.status || undefined,
    department: filters.department || undefined,
    service: filters.service || undefined,
    coverage: filters.coverage || undefined,
    portal: filters.portal || undefined,
  };
  const stats = useUserStats(statsParams);
  const list = useUserList(filters);

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          accent="blue"
          label="Active users"
          value={stats.data?.active_users ?? 0}
          caption="People currently in service"
          loading={stats.isLoading}
          onView={() => patch({ status: 'Active', coverage: '' })}
          viewLabel="Show active users"
        />
        <KpiCard
          icon={Laptop}
          accent="indigo"
          label="Without a device"
          value={stats.data?.without_device ?? 0}
          caption="Active users with no active device"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'no_device', status: '' })}
          viewLabel="Show users without a device"
        />
        <KpiCard
          icon={UserMinus}
          tone="alert"
          accent="slate"
          label="Disabled with services"
          value={stats.data?.disabled_with_services ?? 0}
          caption="Offboarding never completed"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'disabled_with_services', status: '' })}
          viewLabel="Show incomplete offboardings"
        />
        <KpiCard
          icon={ShieldAlert}
          tone="alert"
          accent="slate"
          label="Unprotected devices"
          value={stats.data?.unprotected_devices ?? 0}
          caption="Active devices with no security"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'no_security', status: '' })}
          viewLabel="Show users without protection"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setNewUserOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus size={15} />
          New user
        </button>
      </div>

      <FilterBar
        values={filters as unknown as FilterState}
        search={filters.search}
        searchPlaceholder="Search name, department or hostname…"
        subtitle="Narrow the user register."
        onSearch={(value) => patch({ search: value })}
        onApply={(values) =>
          patch({
            customer: (values.customer as string) ?? '',
            status: (values.status as string) ?? '',
            department: (values.department as string) ?? '',
            service: (values.service as string) ?? '',
            coverage: (values.coverage as string) ?? '',
            portal: (values.portal as string) ?? '',
          })
        }
        onClear={clear}
        onRefresh={() => list.refetch()}
        exportUrl={internal.usersExportUrl(statsParams)}
        fields={[
          {
            key: 'customer',
            label: 'Customer',
            kind: 'select',
            allLabel: 'All customers',
            options: (options.data?.customers ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'All statuses',
            options: (options.data?.statuses ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'department',
            label: 'Department',
            kind: 'select',
            allLabel: 'All departments',
            options: (options.data?.departments ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'service',
            label: 'Subscribed service',
            kind: 'select',
            allLabel: 'Any service',
            options: options.data?.services ?? [],
          },
          {
            key: 'coverage',
            label: 'Coverage',
            kind: 'select',
            allLabel: 'Any coverage',
            options: COVERAGE_OPTIONS,
          },
          {
            key: 'portal',
            label: 'Portal access',
            kind: 'select',
            allLabel: 'With or without',
            options: PORTAL_OPTIONS,
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white pt-4 shadow-sm">
        <div className="max-h-[62vh] overflow-auto px-5 pb-1">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${index === 0 ? 'rounded-l-lg' : ''
                      } ${index === COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!!list.error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-red-600">
                    {(list.error as Error)?.message || 'Failed to load users.'}
                  </td>
                </tr>
              )}

              {!list.error && list.isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!list.error && !list.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No user matches these filters.
                  </td>
                </tr>
              )}

              {!list.error &&
                !list.isLoading &&
                rows.map((row) => (
                  <tr
                    key={row.name}
                    onClick={() => navigate(`/msp/users/${row.name}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {row.full_name}
                      {row.email && (
                        <p className="text-xs text-slate-400">{row.email}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.department || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.customer}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3">
                      {row.hostnames ? (
                        <>
                          <p className="truncate text-sm text-slate-700" title={row.hostnames}>
                            {row.hostnames}
                          </p>
                          {row.device_type && (
                            <p className="text-xs text-slate-400">{row.device_type}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 tabular-nums">
                        {row.active_services}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${row.inactive_services
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-transparent text-slate-300'
                          }`}
                      >
                        {row.inactive_services}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'View profile',
                              icon: Eye,
                              onClick: () => navigate(`/msp/users/${row.name}`),
                            },
                            {
                              label: 'Their devices',
                              icon: Laptop,
                              onClick: () =>
                                navigate(
                                  `/msp/devices?q=${encodeURIComponent(row.full_name)}`
                                ),
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

        <TablePagination
          start={filters.start}
          pageLength={filters.pageLength}
          total={list.data?.total ?? 0}
          loading={list.isLoading}
          onPrevious={() => patch({ start: Math.max(filters.start - filters.pageLength, 0) })}
          onNext={() => patch({ start: filters.start + filters.pageLength })}
          onPageLengthChange={(size) => patch({ pageLength: size, start: 0 })}
        />
      </div>

      <NewUserModal
        open={newUserOpen}
        onClose={() => setNewUserOpen(false)}
        onCreated={(clientUser) => {
          setNewUserOpen(false);
          navigate(`/msp/users/${clientUser}`);
        }}
      />
    </div>
  );
}
