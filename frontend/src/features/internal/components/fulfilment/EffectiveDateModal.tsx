import React, { useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import TruncatedNote from '@/shared/components/TruncatedNote';
import type { WorkCard } from '@/lib/api/internal';
import { useSelectableClientUsers } from '../../hooks/useRequests';
import { inputClass } from '../../lib/fulfilmentStyles';
import { primaryButton, secondaryButton } from '../../lib/workDisplay';

type Props = {
  title: string;
  subtitle: string;
  cards: WorkCard[];
  requestedDate: string | null;
  createdOn?: string | null;
  busy: boolean;
  customer?: string | null;
  grouped?: boolean;
  onClose: () => void;
  onConfirm: (date: string, invoiced: Set<string>, handOver?: HandOver) => void;
};

export type HandOver = { execution_holder: string; override_reason?: string };

const HAND_OVERS = new Set(['device.assign', 'device.transfer']);

const handOverCard = (cards: WorkCard[], grouped: boolean) => {
  const [card] = cards;
  if (grouped || cards.length !== 1 || !HAND_OVERS.has(card.operation_code ?? '')) return null;
  if (!card.requested_holder && card.requested_holder_requested_client_user) return null;
  return card;
};

const MIXED_DATES =
  'These work orders were requested for different dates. The date below applies to all of them.';

const datesOf = (cards: WorkCard[], requestedDate: string | null) =>
  new Set(cards.map((card) => card.effective_date || requestedDate || ''));

const dayOf = (moment: string | null | undefined) => (moment ? moment.slice(0, 10) : '');

const openingDate = (cards: WorkCard[], requestedDate: string | null, floor: string) => {
  const dates = datesOf(cards, requestedDate);
  const [shared] = [...dates];
  const opening = dates.size === 1 && shared ? shared : requestedDate || format(new Date(), 'yyyy-MM-dd');

  return floor && opening < floor ? floor : opening;
};

const EffectiveDateModal: React.FC<Props> = ({
  title,
  subtitle,
  cards,
  requestedDate,
  createdOn = null,
  busy,
  customer = null,
  grouped = false,
  onClose,
  onConfirm,
}) => {
  const floor = dayOf(createdOn);
  const [date, setDate] = useState(() => openingDate(cards, requestedDate, floor));
  const handing = handOverCard(cards, grouped);
  const requestedHolder = handing?.requested_holder ?? '';
  const [holder, setHolder] = useState(requestedHolder);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const people = useSelectableClientUsers(handing ? customer : null, search);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const changed = Boolean(handing && holder !== requestedHolder);
  const needsReason = changed && Boolean(requestedHolder);
  const blocked = Boolean(handing && !holder) || (needsReason && !reason.trim());

  const holderOptions = [
    ...(requestedHolder
      ? [
          {
            value: requestedHolder,
            label: handing?.requested_holder_name || requestedHolder,
            description: 'Requested holder',
          },
        ]
      : []),
    ...(holder && holder !== requestedHolder && pickedName && !people.data?.rows.some((row) => row.name === holder)
      ? [{ value: holder, label: pickedName }]
      : []),
    ...(people.data?.rows ?? [])
      .filter((row) => row.name !== requestedHolder)
      .map((row) => ({
        value: row.name,
        label: row.full_name,
        description: row.selectable
          ? (row.department ?? undefined)
          : [row.lifecycle_status, row.disabled_reason].filter(Boolean).join(' · '),
        disabled: !row.selectable,
      })),
  ];

  const confirm = () => {
    const invoicedNames = new Set(invoiced.map((card) => card.name));
    if (!handing || !changed) {
      onConfirm(date, invoicedNames);
      return;
    }
    onConfirm(date, invoicedNames, {
      execution_holder: holder,
      ...(needsReason ? { override_reason: reason.trim() } : {}),
    });
  };

  const mixed = datesOf(cards, requestedDate).size > 1;
  const invoiced = cards.filter(
    (card) => Boolean(date && card.current?.billed_to && date <= card.current.billed_to)
  );

  return (
    <Modal
      open
      onClose={onClose}
      icon={CalendarDays}
      title={title}
      subtitle={subtitle}
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!date || (Boolean(floor) && date < floor) || busy || blocked}
            onClick={confirm}
            className={primaryButton}
          >
            {title}
          </button>
        </div>
      }
    >
      {mixed && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          {MIXED_DATES}
        </p>
      )}

      <div>
        <FieldLabel required>Effective date</FieldLabel>
        <input
          type="date"
          className={inputClass}
          value={date}
          min={floor || undefined}
          onChange={(event) => setDate(event.target.value)}
          aria-label="Effective date"
        />
        <p className="mt-1 text-[11px] text-slate-500">Billing counts from this date.</p>
      </div>

      {handing && (
        <div className="mt-3 space-y-3">
          <div>
            <Select
              label="Hand over to"
              className="w-full"
              value={holder}
              onChange={(next) => {
                setHolder(next);
                setPickedName(people.data?.rows.find((row) => row.name === next)?.full_name ?? null);
              }}
              onSearch={setSearch}
              footnote={<TruncatedNote page={people.data} />}
              placeholder="Choose a Client User"
              options={holderOptions}
            />
          </div>
          {needsReason && (
            <div>
              <FieldLabel required>Reason</FieldLabel>
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="Reason"
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Explain why this Device goes to somebody else than requested.
              </p>
            </div>
          )}
        </div>
      )}

      {invoiced.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="text-sm font-semibold text-amber-900">This period has already been invoiced.</p>
          <p className="mt-0.5 text-xs text-amber-800">
            The work can still be carried out on this date. The existing invoice is not changed:
            handle any financial adjustment separately.
          </p>
          {cards.length > 1 && (
            <p className="mt-1 text-xs text-amber-800">
              Already invoiced: {invoiced.map((card) => card.target.label).join(', ')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default EffectiveDateModal;
