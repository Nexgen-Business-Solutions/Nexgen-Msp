import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Laptop, TriangleAlert } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import { usePortalUserDetail } from '../hooks/usePortal';
import type { PortalUserService } from '@/lib/api/portal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
    <div className="mt-2">{children}</div>
  </section>
);

const ServiceRows = ({
  rows,
  empty,
  onAsk,
}: {
  rows: PortalUserService[];
  empty: string;
  onAsk: (service: PortalUserService) => void;
}) => (
  <div className="space-y-2">
    {rows.length === 0 && (
      <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">{empty}</p>
    )}
    {rows.map((row) => (
      <div
        key={row.name}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{row.service_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {row.operational_status} since {fmtDate(row.effective_start_date)}
          </p>
          {row.pending_request && (
            <p className="mt-0.5 text-xs font-medium text-blue-700">
              A change is already under way · {row.pending_request}
            </p>
          )}
        </div>
        {row.allowed_actions.length > 0 && !row.pending_request && (
          <button
            type="button"
            onClick={() => onAsk(row)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Request a change
          </button>
        )}
      </div>
    ))}
  </div>
);

/**
 * One of their people, read the way our own team reads them: their own services are theirs,
 * and the services on the machine they hold belong to the machine.
 *
 * A customer states a need; they do not administer the asset. Every action here raises a
 * request, and nothing internal to us is shown.
 */
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

  const { user } = data;

  const ask = (params: Record<string, string>) =>
    navigate(`/msp/requests/new?${new URLSearchParams(params).toString()}`);

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/users')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to people
      </button>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">{user.full_name}</h1>
              <StatusBadge value={user.lifecycle_status} />
            </div>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {user.department || 'No department'}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              {[user.email, user.username].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              In service since {fmtDate(user.start_date)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => ask({ client_user: user.name })}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Request a change
          </button>
        </div>
      </section>

      {data.attention.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Attention
          </h2>
          <ul className="mt-2 space-y-1.5">
            {data.attention.map((signal) => (
              <li
                key={`${signal.code}-${signal.entity}`}
                className="flex items-start gap-2 text-sm text-amber-900"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
                {signal.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.open_requests.length > 0 && (
        <Section title="Open requests">
          <div className="space-y-2">
            {data.open_requests.map((request) => (
              <button
                key={request.name}
                type="button"
                onClick={() => navigate(`/msp/requests/${request.name}`)}
                className="flex w-full flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    {request.name}
                    <ArrowUpRight size={13} className="text-slate-400" />
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {request.lines.map((line) => (
                      <li key={line.idx} className="text-xs text-slate-600">
                        {line.action} {line.service_name}
                        {line.hostname ? ` on ${line.hostname}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                <StatusBadge value={request.status} />
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Their services">
        <ServiceRows
          rows={data.personal_services.current}
          empty={`Nothing is open for ${user.full_name}.`}
          onAsk={(service) =>
            ask({ client_user: user.name, assignment: service.name, action: 'Change' })
          }
        />
      </Section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Devices
        </h2>

        {data.devices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Laptop size={15} className="text-slate-400" />
              {user.full_name} currently holds no device.
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => ask({ client_user: user.name, device: 'new' })}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Request a device
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {data.devices.map((slot) => (
              <div
                key={slot.device.name}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <Laptop size={15} className="text-slate-400" />
                      {slot.device.hostname}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {slot.device.device_type || 'Unknown type'}
                      {slot.device.serial_number ? ` · Serial ${slot.device.serial_number}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Held since {fmtDate(slot.holder_since)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => ask({ client_user: user.name, device: slot.device.name })}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Request a change
                  </button>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <ServiceRows
                    rows={slot.services.current}
                    empty="Nothing is running on this machine."
                    onAsk={(service) =>
                      ask({
                        client_user: user.name,
                        device: slot.device.name,
                        assignment: service.name,
                        action: 'Change',
                      })
                    }
                  />
                  {(slot.services.history?.length ?? 0) > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Service history
                      </p>
                      <ul className="space-y-2">
                        {slot.services.history?.map((service) => (
                          <li
                            key={service.name}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-700">
                                {service.service_name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {fmtDate(service.effective_start_date)} to{' '}
                                {fmtDate(service.effective_end_date)}
                              </p>
                            </div>
                            <StatusBadge value={service.operational_status} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
