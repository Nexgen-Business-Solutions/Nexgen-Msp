import { useState } from 'react';
import { AlertCircle, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';

type Props = {
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onReject: (reason: string) => void;
};

export default function RequestApprovalBar({ busy = false, error, onApprove, onReject }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const close = () => {
    setRejecting(false);
    setReason('');
  };

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Internal approval required</p>
          <p className="text-xs text-slate-500">
            Approval records intent only. No MSP lifecycle operation is executed here.
          </p>
          {error && !rejecting && (
            <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-red-700">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReason('');
              setRejecting(true);
            }}
            className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            Approve and send to Nexgen
          </button>
        </div>
      </div>

      <Modal
        open={rejecting}
        onClose={close}
        icon={TriangleAlert}
        tone="red"
        title="Reject request"
        subtitle="A reason is required and will be visible in the request history."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reason.trim() || busy}
              onClick={() => {
                onReject(reason.trim());
                close();
              }}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Reject request
            </button>
          </div>
        }
      >
        <label htmlFor="request-reject-reason" className="mb-1.5 block text-xs font-semibold text-slate-700">
          Reason *
        </label>
        <textarea
          id="request-reject-reason"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>
    </>
  );
}
