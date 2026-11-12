import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { today } from '@/shared/lib/today';
import type { ServiceAvailability, ServiceAvailabilityCurrent } from '@/lib/api/internal';
import { useAssignCustomerService, useChangeCustomerService } from '../hooks/useCustomerDetails';

type Props = {
  customer: string;
  label?: string;
  reading?: ServiceAvailability;
  /** The running period whose quantity is being changed; absent means a new service. */
  changing?: ServiceAvailabilityCurrent | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

/**
 * A service the company itself holds: a retainer, a block of storage, a line.
 *
 * There is no person and no machine to name, so the only thing the form asks beyond the
 * service is how much of it — and that quantity is the whole reason a company line reads
 * "5 TB" rather than "1".
 *
 * What it is sold at is asked here too. A rate agreed by hand is the one number Billing
 * takes literally, so it is never changed silently: the reason is asked with it.
 */
const CustomerServiceModal: React.FC<Props> = ({
  customer,
  label,
  reading,
  changing,
  onClose,
}) => {
  const assign = useAssignCustomerService(customer);
  const change = useChangeCustomerService(customer);
  const acting = changing ? change : assign;

  const [service, setService] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [notes, setNotes] = useState('');

  const held =
    changing?.price_source === 'Manual Override' && changing?.agreed_rate != null
      ? Number(changing.agreed_rate)
      : null;

  useEffect(() => {
    setService(changing?.service_item ?? '');
    setQuantity(String(changing?.quantity ?? 1));
    setRate(held === null ? '' : String(held));
    setReason('');
    setEffectiveDate(today());
    setNotes('');
    assign.reset();
    change.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changing]);

  const refusal = reading?.target_reason ?? null;
  const available = refusal ? [] : (reading?.available ?? []);
  const selected = available.find((item) => item.service_item === service);
  const asked = Number(quantity);
  const wanted = rate.trim() === '' ? null : Number(rate);
  const repriced = wanted !== null && wanted !== held;
  const unexplained = repriced && !reason.trim();
  const impossible =
    !Number.isFinite(asked) ||
    asked <= 0 ||
    (wanted !== null && (!Number.isFinite(wanted) || wanted < 0));
  const unchanged =
    Boolean(changing) && asked === Number(changing?.quantity ?? 0) && !repriced;

  const submit = async () => {
    try {
      // a rate that was not touched is not sent: the service keeps the terms it has
      const priced = repriced
        ? { agreed_rate: wanted as number, rate_override_reason: reason.trim() }
        : {};

      if (changing) {
        await change.mutateAsync({
          assignment: changing.name,
          action: 'Change',
          quantity: asked,
          effective_date: effectiveDate || undefined,
          notes: notes.trim() || undefined,
          ...priced,
        });
      } else {
        await assign.mutateAsync({
          customer,
          service_item: service,
          quantity: asked,
          effective_date: effectiveDate || undefined,
          notes: notes.trim() || undefined,
          ...priced,
        });
      }

      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Building2}
      tone="emerald"
      title={changing ? 'Change what the company holds' : 'Add a service the company holds'}
      subtitle={label || customer}
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!service || impossible || unchanged || unexplained || acting.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {acting.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : changing ? (
              'Save change'
            ) : (
              'Add service'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {refusal && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <span className="text-sm font-medium text-amber-900">{refusal}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Service</FieldLabel>
            {changing ? (
              <p className="flex h-10 items-center text-sm font-semibold text-slate-900">
                {changing.item_name}
              </p>
            ) : (
              <Select
                searchable
                className="w-full"
                value={service}
                onChange={setService}
                label="Service"
                placeholder={
                  available.length ? 'Select a service' : 'No company service left to add'
                }
                options={available.map((item) => ({
                  value: item.service_item,
                  label: item.item_name,
                  description: item.warning ?? 'Billed to the company',
                }))}
              />
            )}
          </div>

          <div>
            <FieldLabel required>Quantity</FieldLabel>
            <input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-label="Quantity"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              {changing?.uom
                ? `Counted in ${changing.uom}. The invoice says the units beside the months.`
                : 'How much of it the company holds, in the unit the service is sold in.'}
            </p>
          </div>

          <div>
            <FieldLabel>Agreed rate</FieldLabel>
            <input
              type="number"
              min="0"
              step="any"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              aria-label="Agreed rate"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              {held === null
                ? 'Leave it empty to sell it at the contract rate.'
                : `Agreed by hand at ${held}. Leave it as it is to keep that rate.`}
            </p>
          </div>

          <div>
            <FieldLabel>Effective date</FieldLabel>
            <input
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              aria-label="Effective date"
              className={inputClass}
            />
          </div>
        </div>

        {repriced && (
          <div>
            <FieldLabel required>Why this rate</FieldLabel>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What was agreed, and with whom."
              aria-label="Why this rate"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              Billing takes this rate literally, so the reason is kept with the number.
            </p>
          </div>
        )}

        {changing && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            The running period closes the day before and a new one opens on that day, so every
            invoice keeps reading the quantity that was really in force over its days.
          </p>
        )}

        {selected?.warning && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">No customer service rate yet</p>
              <p className="mt-0.5">{selected.warning} The service will still be added.</p>
            </div>
          </div>
        )}

        <div>
          <FieldLabel>Internal note</FieldLabel>
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What you did and why — kept for Nexgen, not shown to the customer."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {acting.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{acting.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CustomerServiceModal;
