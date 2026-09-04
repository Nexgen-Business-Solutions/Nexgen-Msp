import React, { useState } from 'react';
import { AlertCircle, Laptop, User } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import { useSetDeliveryDetail } from '../hooks/useRequests';
import type { RequestDetail } from '@/lib/api/internal';
import { outstanding, type Want } from '../lib/delivery';

type Props = {
  request: RequestDetail;
  onClose: () => void;
  onComplete: () => void;
};


const DeliveryDetailsModal: React.FC<Props> = ({ request, onClose, onComplete }) => {
  const wants = outstanding(request);
  const save = useSetDeliveryDetail();
  const [values, setValues] = useState<Record<string, string>>({});

  const keyOf = (want: Want) => `${want.idx}:${want.field}`;
  const filled = wants.every((want) => (values[keyOf(want)] ?? '').trim());

  const submit = async () => {
    for (const want of wants) {
      await save.mutateAsync({
        name: request.name,
        idx: want.idx,
        [want.field]: values[keyOf(want)].trim(),
      });
    }

    onComplete();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="What was delivered"
      subtitle="Needed before this request can be closed: they identify the machine and the account the licence is issued against."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!filled || save.isLoading}
            onClick={submit}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isLoading ? 'Saving…' : 'Save and close the request'}
          </button>
        </>
      }
    >
      {save.error instanceof Error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{save.error.message}</span>
        </div>
      )}

      <div className="space-y-4">
        {wants.map((want) => {
          const serial = want.field === 'serial_number';
          const Icon = serial ? Laptop : User;

          return (
            <div key={keyOf(want)}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Icon size={14} className="text-slate-400" />
                {serial ? 'Serial number' : 'Username'} for {want.subject}
              </span>
              <p className="mt-0.5 text-xs text-slate-400">
                Line {want.idx} · {want.service}
              </p>
              <input
                type="text"
                autoFocus={want === wants[0]}
                value={values[keyOf(want)] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [keyOf(want)]: event.target.value }))
                }
                placeholder={serial ? 'Read it off the machine' : 'The account name on the licence'}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default DeliveryDetailsModal;
