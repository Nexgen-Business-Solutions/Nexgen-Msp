import React, { useState } from 'react';
import { Ban, RotateCcw, TriangleAlert, XCircle } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import type { WorkCard } from '@/lib/api/internal';
import {
  useBlockWorkItem,
  useCancelWorkItem,
  useFailWorkItem,
  useResumeWorkItem,
} from '../../hooks/useRequests';

type Kind = 'block' | 'fail' | 'cancel';

const TITLE: Record<Kind, string> = {
  block: 'Block this work',
  fail: 'Mark this work as failed',
  cancel: 'Give this work up',
};

/** What can be said about work that will not go through, each with the reason it needs. */
const WorkItemMenu: React.FC<{ card: WorkCard }> = ({ card }) => {
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const block = useBlockWorkItem();
  const fail = useFailWorkItem();
  const cancel = useCancelWorkItem();
  const resume = useResumeWorkItem();

  const heldUp = card.status === 'Blocked' || card.status === 'Failed';
  const mutation = kind === 'block' ? block : kind === 'fail' ? fail : cancel;

  const open = (next: Kind) => {
    setReason('');
    mutation.reset();
    setKind(next);
  };

  const send = async () => {
    if (!kind || !reason.trim()) return;
    try {
      await mutation.mutateAsync({ work_order: card.name, reason: reason.trim() });
      setKind(null);
    } catch {
      // shown in the dialog
    }
  };

  return (
    <>
      <RowActionsMenu
        actions={[
          { label: 'Resume work', icon: RotateCcw, onClick: () => resume.mutate({ work_order: card.name }), disabled: !heldUp },
          { label: 'Block', icon: Ban, onClick: () => open('block'), disabled: heldUp },
          { label: 'Mark failed', icon: TriangleAlert, onClick: () => open('fail'), disabled: heldUp },
          { label: 'Give this up', icon: XCircle, onClick: () => open('cancel'), danger: true },
        ]}
      />

      <Modal
        open={Boolean(kind)}
        onClose={() => setKind(null)}
        icon={TriangleAlert}
        tone="amber"
        title={kind ? TITLE[kind] : ''}
        subtitle="A reason is required and stays on the record."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setKind(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!reason.trim() || mutation.isLoading}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        }
      >
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label="Reason"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        />
        {mutation.error instanceof Error && (
          <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {mutation.error.message}
          </p>
        )}
      </Modal>
    </>
  );
};

export default WorkItemMenu;
