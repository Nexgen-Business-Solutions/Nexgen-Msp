import React from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { RequestPresentation } from '@/shared/request';
import { useRequestPreview, useRequestSubmissionContext } from '../hooks/usePortal';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const RequestReviewStep: React.FC<{ builder: Builder; onEditActions: () => void }> = ({
  builder,
  onEditActions,
}) => {
  const preview = useRequestPreview(builder.payload);
  const submission = useRequestSubmissionContext();

  if (preview.isLoading) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        Preparing the review…
      </p>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-4">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
        <span className="text-sm font-medium text-red-700">
          {(preview.error as Error | null)?.message || 'The review could not be prepared.'}
        </span>
      </div>
    );
  }

  return (
    <RequestPresentation
      presentation={preview.data}
      mode="creation_review"
      headerActions={
        <>
          <button
            type="button"
            onClick={onEditActions}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Edit actions
          </button>
          <button
            type="button"
            onClick={() => builder.send()}
            disabled={!builder.canSend || builder.sending}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {builder.editing
              ? builder.sending
                ? 'Saving…'
                : 'Save changes'
              : builder.sending
                ? 'Sending…'
                : 'Submit request'}
          </button>
        </>
      }
      notice={
        submission.data ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
            <div>
              <p className="text-sm font-semibold text-blue-900">After submission</p>
              <p className="mt-0.5 text-sm text-blue-800">{submission.data.message}</p>
            </div>
          </div>
        ) : undefined
      }
    />
  );
};

export default RequestReviewStep;
