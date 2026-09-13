import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { isBilledPeriod } from '@/shared/lib/billedPeriod';
import FieldLabel from '@/shared/components/FieldLabel';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useExecuteServiceAction } from '../../hooks/useRequests';
import { identifierMissing, inputClass } from '../../lib/fulfilmentStyles';

type Props = {
  card: WorkCard | null;
  person: SubjectWorkGroup['person'];
  onClose: () => void;
};

/** What a service act needs to run: the day it takes effect, and the one fact it is issued against. */
const ApplyActionModal: React.FC<Props> = ({ card, person, onClose }) => {
  const run = useExecuteServiceAction();
  const [date, setDate] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [identifier, setIdentifier] = useState('');
  const [billedWarning, setBilledWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!card) return;
    setDate(card.effective_date ?? new Date().toISOString().slice(0, 10));
    setQuantity(String(card.requested_quantity ?? 1));
    setIdentifier('');
    setBilledWarning(null);
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  if (!card) return null;

  const onDevice = card.target_scope === 'Device';
  const missing = identifierMissing(card, person);

  const submit = async (confirmBilled = false) => {
    try {
      await run.mutateAsync({
        confirm_billed: confirmBilled ? 1 : undefined,
        work_order: card.name,
        effective_date: date || undefined,
        quantity: card.action === 'Change' ? Number(quantity) : undefined,
        username: !onDevice && identifier.trim() ? identifier.trim() : undefined,
        serial_number: onDevice && identifier.trim() ? identifier.trim() : undefined,
      });
      setBilledWarning(null);
      onClose();
    } catch (error) {
      if (isBilledPeriod(error)) {
        setBilledWarning(error.message);
        run.reset();
      }
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Play}
      tone="blue"
      title={`${card.service_name ?? card.service_item} · ${card.action_label ?? card.action}`}
      subtitle={`${person?.full_name ?? ''} · ${card.target_scope} scope${
        onDevice && card.device?.hostname ? ` · ${card.device.hostname}` : ''
      }`}
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit()}
            disabled={run.isLoading || (missing && !identifier.trim())}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {run.isLoading ? 'Working…' : card.action_label ?? card.action}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Effective date</FieldLabel>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Effective date"
          />
        </div>
        {card.action === 'Change' && (
          <div>
            <FieldLabel>Quantity</FieldLabel>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-label="Quantity"
            />
          </div>
        )}
        {missing && (
          <div>
            <FieldLabel required>{onDevice ? 'Serial Number' : 'Username'}</FieldLabel>
            <input
              className={inputClass}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={onDevice ? 'Read it off the machine' : 'The name on the licence'}
              aria-label={onDevice ? 'Serial Number' : 'Username'}
            />
          </div>
        )}
      </div>

      {card.technician_reason && (
        <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800">
          Added by the technician: {card.technician_reason}
        </p>
      )}

      {run.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {run.error.message}
        </p>
      )}
      <ConfirmModal
        open={Boolean(billedWarning)}
        tone="warning"
        title="This period is already invoiced"
        description={billedWarning ?? ''}
        confirmLabel="Go ahead"
        loading={run.isLoading}
        onCancel={() => setBilledWarning(null)}
        onConfirm={() => submit(true)}
      />
    </Modal>
  );
};

export default ApplyActionModal;
