import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, UserCheck, UserX, Users } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import ColumnsModal from '@/shared/components/ColumnsModal';
import { PORTAL_USERS, loadChoice } from '@/shared/exportColumns';
import { PORTAL_USER_LIST } from '@/shared/listColumns';
import StatusBadge from '@/shared/components/StatusBadge';
import type { ClientUser } from '@/lib/api/portal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiCard from '@/shared/components/KpiCard';
import * as portal from '@/lib/api/portal';
import { useClientUserPage, usePortalFilterOptions, usePortalSummary, useSubscribedServices } from '../hooks/usePortal';
import { useMyApprovalRights } from '../hooks/usePortal';
import { usePortalFilters } from '../store/usePortalFilters';

const EMPTY: FilterState = { status: '', service: '' };

export default function PortalUsers() {
  const [picking, setPicking] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  // what this person chose to see, kept in their browser
  const [shown, setShown] = useState(() => loadChoice(PORTAL_USER_LIST).columns);
  const rights = useMyApprovalRights();
  const canSubmit = rights.data?.can_submit !== false;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>({
    ...EMPTY,
    service: params.get('service') ?? '',
  });
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [pageLength, setPageLength] = useState(20);

  const summary = usePortalSummary();
  const services = useSubscribedServices();
  // staff read a customer's register through the portal: the sheet is that customer's too
  const customer = usePortalFilters((state) => state.customer);
  const filterOptions = usePortalFilterOptions();
  const list = useClientUserPage({
    search: search || undefined,
    status: (filters.status as string) || undefined,
    service: (filters.service as string) || undefined,
    start,
    page_length: pageLength,
  });

  const rows = list.data?.rows ?? [];
  const labels = Object.fromEntries(PORTAL_USER_LIST.columns.map((column) => [column.key, column.label]));

  const cell = (key: string, row: ClientUser) => {
    switch (key) {
      case 'user':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(`/msp/users/${row.name}`)}
              className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
            >
              {row.full_name}
            </button>
            {row.username && <p className="text-xs text-slate-500">{row.username}</p>}
            {row.email && <p className="text-xs text-slate-400">{row.email}</p>}
          </td>
        );
      case 'status':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <StatusBadge value={row.lifecycle_status} />
          </td>
        );
      case 'devices':
        return (
          <td key={key} className="max-w-[14rem] px-4 py-3">
            {row.hostnames ? (
              <>
                <p className="truncate text-sm text-slate-700" title={row.hostnames}>
                  {row.hostnames}
                </p>
                {row.device_type && <p className="text-xs text-slate-400">{row.device_type}</p>}
              </>
            ) : (
              <span className="text-sm text-slate-400">N/A</span>
            )}
          </td>
        );
      case 'active_services':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 tabular-nums">
              {row.active_services}
            </span>
          </td>
        );
      case 'inactive_services':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span
              className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
                row.inactive_services ? 'bg-slate-100 text-slate-600' : 'bg-transparent text-slate-300'
              }`}
            >
              {row.inactive_services}
            </span>
          </td>
        );
      case 'open_requests':
      case 'current_devices':
      case 'personal_services':
      case 'device_services':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span
              className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
                row[key]
                  ? key === 'open_requests'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-slate-100 text-slate-600'
                  : 'bg-transparent text-slate-300'
              }`}
            >
              {row[key] ?? 0}
            </span>
          </td>
        );
      case 'start_date':
      case 'disabled_date':
      case 'last_billed_on':
      case 'covered_until':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {row[key] ? String(row[key]).slice(0, 10) : 'N/A'}
          </td>
        );
      default: {
        const value = row[key as 'username' | 'department' | 'serial_numbers' | 'services'];

        return (
          <td key={key} className="max-w-[16rem] px-4 py-3 text-sm text-slate-600">
            {value ? <span className="line-clamp-2" title={value}>{value}</span> : <span className="text-slate-400">N/A</span>}
          </td>
        );
      }
    }
  };

  const apply = (values: FilterState) => {
    setFilters(values);
    setStart(0);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Users}
          accent="blue"
          label="People"
          value={summary.data?.client_users ?? 0}
          caption="Everyone on file with us"
          loading={summary.isLoading}
          onView={() => apply(EMPTY)}
        />
        <KpiCard
          icon={UserCheck}
          accent="indigo"
          label="Active"
          value={summary.data?.active_client_users ?? 0}
          caption="Currently in service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Active' })}
        />
        <KpiCard
          icon={UserX}
          tone="alert"
          accent="slate"
          label="Disabled"
          value={summary.data?.disabled_client_users ?? 0}
          caption="No longer in service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Disabled' })}
        />
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a name, a username or an email…"
        subtitle="Everyone your company has with us."
        onSearch={(value) => {
          setSearch(value);
          setStart(0);
        }}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        onExport={() => setPicking(true)}
        onColumns={() => setChoosingColumns(true)}
        fields={[
          {
            key: 'service',
            label: 'Service',
            kind: 'select',
            allLabel: 'Any service',
            options: (services.data?.services ?? []).map((row) => ({
              value: row.service_item,
              label: row.item_name,
            })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'Any status',
            options: (filterOptions.data?.user_statuses ?? []).map((value) => ({
              value,
              label: value,
            })),
          },
        ]}
      />

      <DataTable
        title="People"
        columns={[...shown.map((key) => labels[key]), '']}
        rowCount={rows.length}
        isLoading={list.isLoading}
        error={list.error}
        emptyLabel="Nobody matches these filters."
        showToolbar={false}
        start={start}
        pageLength={pageLength}
        total={list.data?.total ?? 0}
        onPrevious={() => setStart(Math.max(start - pageLength, 0))}
        onNext={() => setStart(start + pageLength)}
        onPageLengthChange={(size) => {
          setPageLength(size);
          setStart(0);
        }}
      >
        {rows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            {shown.map((key) => cell(key, row))}
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'Open profile',
                      icon: Eye,
                      onClick: () => navigate(`/msp/users/${row.name}`),
                    },
                    ...(canSubmit
                      ? [
                    {
                      label: 'Raise a request for them',
                      icon: FilePlus2,
                      onClick: () =>
                        navigate(`/msp/requests/new?client_user=${encodeURIComponent(row.name)}`),
                    },
                        ]
                      : []),
                  ]}
                />
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <ColumnsModal
        open={choosingColumns}
        mode="listing"
        catalogue={PORTAL_USER_LIST}
        onClose={() => setChoosingColumns(false)}
        onConfirm={(choice) => setShown(choice.columns)}
      />

      <ColumnsModal
        open={picking}
        catalogue={PORTAL_USERS}
        onClose={() => setPicking(false)}
        onConfirm={(picks) =>
          portal.exportMyPeople(
            {
              customer: customer || undefined,
              search: search || undefined,
              status: (filters.status as string) || undefined,
              service: (filters.service as string) || undefined,
            },
            picks
          )
        }
      />
    </div>
  );
}
