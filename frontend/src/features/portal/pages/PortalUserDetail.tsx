import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Laptop } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { usePortalUserDetail } from '../hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
    <div className="px-5 py-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
    </div>
    <div className="overflow-x-auto px-5 pb-4">{children}</div>
  </div>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg">
    {children}
  </th>
);

const Empty = ({ span, children }: { span: number; children: React.ReactNode }) => (
  <tr>
    <td colSpan={span} className="px-4 py-10 text-center text-sm text-slate-500">
      {children}
    </td>
  </tr>
);

export default function PortalUserDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = usePortalUserDetail(name);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(error as Error)?.message || 'User not found.'}
        </div>
      </div>
    );
  }

  const { user, devices, services, requests } = data;

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-lg font-bold text-slate-900">{user.full_name}</h1>
          <StatusBadge value={user.lifecycle_status} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-400">Department</p>
            <p className="mt-0.5 text-sm text-slate-700">{user.department || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">In service since</p>
            <p className="mt-0.5 text-sm text-slate-700">{fmtDate(user.start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Active services</p>
            <p className="mt-0.5 text-sm text-slate-700 tabular-nums">
              {services.filter((row) => !['Ended', 'Cancelled'].includes(row.operational_status)).length}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Devices</p>
            <p className="mt-0.5 text-sm text-slate-700 tabular-nums">{devices.length}</p>
          </div>
        </div>
      </div>

      <Panel title="Services in use">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th>Service</Th>
              <Th>Device</Th>
              <Th>Started</Th>
              <Th>Ended</Th>
              <Th>Last billed</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {services.length === 0 && <Empty span={6}>No service yet.</Empty>}
            {services.map((row, index) => (
              <tr key={`${row.service_name}-${index}`} className="transition-colors hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{row.service_name}</p>
                  {row.customer_visible_notes && (
                    <p className="text-xs text-slate-400">{row.customer_visible_notes}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {row.hostname || 'N/A'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(row.effective_start_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(row.effective_end_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(row.last_billed_on)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.operational_status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Devices">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th>Device</Th>
              <Th>Type</Th>
              <Th>In service since</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {devices.length === 0 && (
              <Empty span={4}>
                <span className="inline-flex items-center gap-1.5">
                  <Laptop size={15} className="text-slate-400" />
                  No device assigned.
                </span>
              </Empty>
            )}
            {devices.map((device) => (
              <tr key={device.hostname} className="transition-colors hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {device.hostname}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {device.device_type}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(device.assigned_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={device.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Requests for this user">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th>Request</Th>
              <Th>Type</Th>
              <Th>Submitted</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.length === 0 && <Empty span={5}>No request yet.</Empty>}
            {requests.map((row) => (
              <tr
                key={row.name}
                onClick={() => navigate(`/msp/requests/${row.name}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.request_type} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(row.creation)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex justify-end">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'View request',
                          icon: Eye,
                          onClick: () => navigate(`/msp/requests/${row.name}`),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
