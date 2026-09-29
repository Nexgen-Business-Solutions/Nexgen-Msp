import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PencilLine } from 'lucide-react';
import { RequestApprovalBar, RequestPresentation } from '@/shared/request';
import { useDecideRequest, usePortalRequestPresentation, useServiceRequest } from '../hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

export default function PortalRequestDetail() {
  const { name = '' } = useParams();
  const decide = useDecideRequest();
  const navigate = useNavigate();
  const { data, isLoading, error } = useServiceRequest(name);
  const presentation = usePortalRequestPresentation(name);

  if (isLoading || presentation.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (error || !data || presentation.error || !presentation.data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {((error ?? presentation.error) as Error)?.message || 'Request not found.'}
        </div>
      </div>
    );
  }

  const awaiting = data.status === 'Awaiting Customer Approval';
  const deciding = awaiting && data.can_decide;

  const notice =
    data.reviewed_on || data.status === 'Rejected' || (awaiting && !data.can_decide) ? (
      <div className="space-y-3">
        {data.reviewed_on && (
          <p className="text-xs text-slate-500">Reviewed by Nexgen on {fmtDate(data.reviewed_on)}</p>
        )}

        {data.status === 'Rejected' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">
              This request was declined. You can correct it and send it again as a new request.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/new?from=${encodeURIComponent(data.name)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <PencilLine size={15} />
              Edit and resend
            </button>
          </div>
        )}

        {awaiting && !data.can_decide && (
          <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
            {data.has_approver
              ? 'Waiting for approval inside your company. It reaches Nexgen once someone with that right has agreed to it.'
              : 'Waiting for approval inside your company — but nobody at your company holds the right to approve yet. Ask Nexgen to grant it to the person who decides.'}
          </p>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp')}
        className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to dashboard
      </button>

      <RequestPresentation
        presentation={presentation.data}
        mode={deciding ? 'customer_approval' : 'portal_detail'}
        headerActions={
          data.can_edit ? (
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/new?edit=${encodeURIComponent(data.name)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <PencilLine size={15} />
              Edit request
            </button>
          ) : undefined
        }
        notice={notice}
        approvalBar={
          deciding ? (
            <RequestApprovalBar
              busy={decide.isLoading}
              error={decide.error instanceof Error ? decide.error.message : null}
              onApprove={() => decide.mutate({ name: data.name, approve: true })}
              onReject={(reason) => decide.mutate({ name: data.name, approve: false, reason })}
            />
          ) : undefined
        }
      />
    </div>
  );
}
