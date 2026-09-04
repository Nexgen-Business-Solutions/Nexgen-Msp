import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  UserPlus,
  Laptop,
  TriangleAlert,
  X,
} from 'lucide-react';
import Modal from '@/shared/components/Modal';
import StatusBadge from '@/shared/components/StatusBadge';
import CreateUserModal from '../components/CreateUserModal';
import AddDeviceModal from '../components/AddDeviceModal';
import { useUserDetail } from '../hooks/useUsers';
import DeliveryDetailsModal from '../components/DeliveryDetailsModal';
import { outstanding } from '../lib/delivery';
import { useRequestDetail, useRunRequestAction, useSetLineStatus } from '../hooks/useRequests';
import type { RequestDetailLine } from '@/lib/api/internal';
import RequestLinesByPerson, { type PersonLine } from '@/shared/components/RequestLinesByPerson';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');
const fmtStamp = (value?: string | null) =>
  value ? String(value).slice(0, 16).replace('T', ' ') : null;

const DESTRUCTIVE = ['reject', 'cancel'];

/** A line as the technician reads it: the person first, then what was asked for them. */
const asPersonLine = (line: RequestDetailLine, extra?: React.ReactNode): PersonLine => {
  // a device line names nobody, but the machine has a holder and that is who it is about
  const person = line.client_user || line.device_holder;
  // "new" only until the record exists: a line linked to a person is about them
  const isNewUser = Boolean(line.is_new_user) && !person;

  return {
    idx: line.idx,
    person,
    personName: isNewUser ? line.new_user_full_name : line.client_user_name,
    isNewUser,
    username: isNewUser ? line.new_user_username : line.client_username,
    department: isNewUser ? line.new_user_department : line.client_user_department,
    email: line.new_user_email,
    needsPortalAccess: Boolean(line.needs_portal_access),
    action: line.action,
    actionLabel: line.action_label,
    service: line.requested_service_name || line.requested_service,
    onDevice: Boolean(line.managed_device || line.is_new_device),
    isNewDevice: Boolean(line.is_new_device),
    deviceName: line.is_new_device ? line.new_device_label : line.device_hostname,
    serial: line.is_new_device ? line.new_device_serial : line.device_serial,
    deviceType: line.is_new_device ? line.new_device_type : line.device_type,
    requestedFor: line.requested_effective_date,
    status: line.line_status,
    comment: line.comment,
    rejectionReason: line.rejection_reason,
    extra,
  };
};

type ReasonPrompt = { kind: 'action'; action: string; label: string } | { kind: 'line'; idx: number };

export default function RequestDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useRequestDetail(name);
  const runAction = useRunRequestAction();
  const setLine = useSetLineStatus();

  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const [askingDetails, setAskingDetails] = useState(false);
  const [reason, setReason] = useState('');
  const [newUserLine, setNewUserLine] = useState<{
    idx: number;
    full_name: string | null;
    department: string | null;
    email: string | null;
    username: string | null;
  } | null>(null);

  // the machine a request asked for is registered from here, for the person it names
  const [registering, setRegistering] = useState<{
    person: string;
    initial: { hostname: string | null; device_type: string | null; serial_number: string | null };
  } | null>(null);
  const holder = useUserDetail(registering?.person);

  const data = detail.data;
  const actionError = (runAction.error ?? setLine.error) as Error | undefined;

  // a dispute is handled on the invoice it contests, so a direct link lands there
  useEffect(() => {
    if (data?.billing_run) navigate(`/msp/billing/${data.billing_run}`, { replace: true });
  }, [data?.billing_run, navigate]);

  const openPrompt = (next: ReasonPrompt) => {
    setReason('');
    setPrompt(next);
  };

  const confirmPrompt = async () => {
    if (!prompt || !reason.trim()) return;

    try {
      if (prompt.kind === 'action') {
        await runAction.mutateAsync({ name, action: prompt.action, reason: reason.trim() });
      } else {
        await setLine.mutateAsync({
          name,
          idx: prompt.idx,
          line_status: 'Rejected',
          reason: reason.trim(),
        });
      }
      setPrompt(null);
    } catch {
      // the mutation error is rendered in place; keep the prompt open so it can be retried
    }
  };

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Request not found.'}
        </div>
      </div>
    );
  }

  const review = data.review;
  const checkFor = (idx: number) => review?.lines.find((row) => row.idx === idx);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/requests')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to requests
      </button>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">{data.name}</h1>
              <StatusBadge value={data.status} />
              <StatusBadge value={data.priority} />
              <StatusBadge value={data.request_type} />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {data.customer} · raised via {data.source} on {fmtDate(data.creation)}
              {data.requester_name || data.requester
                ? ` by ${data.requester_name ?? data.requester}`
                : ''}
            </p>
            {data.rejection_reason && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {data.rejection_reason}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {data.available_actions.map((action) => {
              const destructive = DESTRUCTIVE.includes(action.action);
              return (
                <button
                  key={action.action}
                  type="button"
                  disabled={runAction.isLoading}
                  onClick={() => {
                    // the closure is refused without them, so they are asked for here
                    // rather than reported as an error after the fact
                    if (action.action === 'complete' && outstanding(data).length) {
                      setAskingDetails(true);
                      return;
                    }

                    if (action.needs_reason) {
                      openPrompt({ kind: 'action', action: action.action, label: action.label });
                    } else {
                      runAction.mutate({ name, action: action.action });
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                    destructive
                      ? 'border border-red-200 bg-white text-red-600 hover:bg-red-50'
                      : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                  }`}
                >
                  {action.label}
                </button>
              );
            })}
            {data.available_actions.length === 0 && (
              <span className="text-xs text-slate-400">No action available at this stage.</span>
            )}
          </div>
        </div>

        {data.reviewed_by && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
            Reviewed by {data.reviewed_by}
            {fmtStamp(data.reviewed_at) ? ` · ${fmtStamp(data.reviewed_at)}` : ''}
          </div>
        )}

        {review && !review.contract_active && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              {review.has_contract
                ? `This customer's contract is ${String(review.contract_status).toLowerCase()}, not active.`
                : 'This customer has no contract yet — nothing here can be billed.'}
            </p>
          </div>
        )}

        {actionError && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{actionError.message}</span>
          </div>
        )}

        <div className="px-6 py-5">
          <RequestLinesByPerson
            lines={data.lines.map((line) => {
              const check = checkFor(line.idx);

              return asPersonLine(
                line,
                check && (
                  <p
                    className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${
                      check.priced ? 'text-slate-500' : 'text-amber-700'
                    }`}
                  >
                    {check.priced ? <Check size={12} /> : <CircleAlert size={12} />}
                    {check.priced
                      ? review?.shows_rates && check.rate !== null
                        ? `Rate ${check.rate.toLocaleString()} ${review.currency ?? ''}`
                        : 'Rate set in contract'
                      : 'No rate — delivered but never billed'}
                    {check.duplicate ? ` · already held (${check.duplicate})` : ''}
                  </p>
                )
              );
            })}
            headerActions={({ first, lines }) => {
              const source = data.lines.find((line) => line.idx === first.idx);
              const wantsDevice = lines.some((line) => line.isNewDevice);

              return (
                <>
                  {wantsDevice && first.person && (
                    <button
                      type="button"
                      onClick={() => {
                        const asked = data.lines.find(
                          (line) =>
                            line.is_new_device && lines.some((row) => row.idx === line.idx)
                        );
                        setRegistering({
                          person: first.person as string,
                          initial: {
                            hostname: asked?.new_device_label ?? null,
                            device_type: asked?.new_device_type ?? null,
                            serial_number: asked?.new_device_serial ?? null,
                          },
                        });
                      }}
                      title="Register this machine for them, with what the request already says"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700"
                    >
                      <Laptop size={15} />
                      Register device
                    </button>
                  )}

                  {first.person && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/msp/users/${first.person}?ref=${encodeURIComponent(name)}`)
                      }
                      title="Open this user, with the request pre-selected"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      Open profile
                      <ArrowUpRight size={15} />
                    </button>
                  )}

                  {first.isNewUser && source && (
                    <button
                      type="button"
                      onClick={() =>
                        setNewUserLine({
                          idx: source.idx,
                          full_name: source.new_user_full_name,
                          department: source.new_user_department,
                          email: source.new_user_email,
                          username: source.new_user_username,
                        })
                      }
                      title="Create this person, then continue on their profile"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                    >
                      <UserPlus size={15} />
                      Create user
                    </button>
                  )}
                </>
              );
            }}
            rowActions={
              data.can_decide_lines
                ? (line) =>
                    line.status === 'Pending' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setLine.mutate({ name, idx: line.idx, line_status: 'Approved' })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                        >
                          <Check size={13} />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => openPrompt({ kind: 'line', idx: line.idx })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                        >
                          <X size={13} />
                          Reject
                        </button>
                      </>
                    )
                : undefined
            }
          />
        </div>
      </div>

      {askingDetails && (
        <DeliveryDetailsModal
          request={data}
          onClose={() => setAskingDetails(false)}
          onComplete={() => {
            setAskingDetails(false);
            runAction.mutate({ name, action: 'complete' });
          }}
        />
      )}

      <CreateUserModal
        open={Boolean(newUserLine)}
        request={name}
        customer={data.customer}
        line={newUserLine}
        onClose={() => setNewUserLine(null)}
        onCreated={() => {
          // the person now exists: their card turns into an existing one, and the machine
          // they were owed can be registered from right here
          setNewUserLine(null);
        }}
      />

      {registering && holder.data && (
        <AddDeviceModal
          open
          clientUser={registering.person}
          userName={holder.data.user.full_name}
          customer={data.customer}
          deviceTypes={holder.data.device_types}
          interfaceTypes={holder.data.interface_types}
          requests={holder.data.customer_requests}
          defaultRequest={name}
          initial={registering.initial}
          onClose={() => setRegistering(null)}
        />
      )}

      <Modal
        open={Boolean(prompt)}
        onClose={() => setPrompt(null)}
        icon={TriangleAlert}
        tone="red"
        title={prompt?.kind === 'line' ? `Reject line ${prompt.idx}` : prompt?.label ?? ''}
        subtitle="A reason is required and stays on the record."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPrompt}
              disabled={!reason.trim() || runAction.isLoading || setLine.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        }
      >
        {actionError && (
          <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{actionError.message}</span>
          </div>
        )}

        <textarea
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain the decision…"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>
    </div>
  );
}
