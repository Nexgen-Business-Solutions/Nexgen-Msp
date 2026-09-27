import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useUserServiceAvailability } from '../../hooks/useUsers';
import { useDeviceServiceAvailability } from '../../hooks/useDevices';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useExecuteServiceAction } from '../../hooks/useRequests';
import { identifiersMissing, inputClass } from '../../lib/fulfilmentStyles';

type Props = {
  card: WorkCard | null;
  person: SubjectWorkGroup['person'];
  /** the operation the technician chose, when it is not the one written on the line */
  operation?: string | null;
  onClose: () => void;
};

const LABEL: Record<string, string> = {
  'service.suspend': 'Suspend',
  'service.resume': 'Resume',
  'service.change': 'Change service',
  'service.end': 'Stop service',
};

/** What a service act needs to run: the day it takes effect, and the one fact it is issued against. */
const ApplyActionModal: React.FC<Props> = ({ card, person, operation, onClose }) => {
  const run = useExecuteServiceAction();
  const [date, setDate] = useState('');
  const [username, setUsername] = useState('');
  const [serial, setSerial] = useState('');
  const [replacement, setReplacement] = useState('');

  const act = operation || card?.operation_code || '';
  const changing = act === 'service.change';
  const onMachine = card?.target_scope === 'Device';
  const userOffers = useUserServiceAvailability(changing && !onMachine ? (person?.name ?? undefined) : undefined);
  const machineOffers = useDeviceServiceAvailability(changing && onMachine ? card?.managed_device : null);
  const offers = (onMachine ? machineOffers.data : userOffers.data)?.available ?? [];
  const chosenLabel = operation ? (LABEL[operation] ?? operation) : null;

  useEffect(() => {
    if (!card) return;
    setDate(card.effective_date ?? new Date().toISOString().slice(0, 10));
    setUsername('');
    setSerial('');
    setReplacement('');
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  if (!card) return null;

  const onDevice = card.target_scope === 'Device';
  const needs = operation ? { username: false, serial: false } : identifiersMissing(card, person);
  // §V2-05-12: an act dated inside an invoiced period still runs, and the screen says so first
  const invoiced = Boolean(card.current?.billed_to && date && date <= card.current.billed_to);
  const label = chosenLabel ?? card.action_label ?? card.action;

  const submit = async () => {
    try {
      await run.mutateAsync({
        work_order: card.name,
        effective_date: date || undefined,
        operation_code: operation && operation !== card.operation_code ? operation : undefined,
        service_item: changing && replacement ? replacement : undefined,
        username: needs.username && username.trim() ? username.trim() : undefined,
        serial_number: needs.serial && serial.trim() ? serial.trim() : undefined,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Play}
      tone="blue"
      title={`${card.service_name ?? card.service_item} · ${label}`}
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
            disabled={run.isLoading || (needs.username && !username.trim()) || (needs.serial && !serial.trim()) || (changing && !replacement)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {run.isLoading ? 'Working…' : label}
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
        {/* a change is always a move onto another service, whoever asked for it */}
        {changing && (
          <div className="sm:col-span-2">
            <FieldLabel required>New service</FieldLabel>
            <Select
              className="w-full"
              value={replacement}
              onChange={setReplacement}
              placeholder="Select the service that replaces it"
              options={offers.map((offer) => ({ value: offer.service_item, label: offer.item_name }))}
            />
          </div>
        )}
        {needs.serial && (
          <div>
            <FieldLabel required>Serial Number</FieldLabel>
            <input
              className={inputClass}
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              placeholder="Read it off the machine"
              aria-label="Serial Number"
            />
          </div>
        )}
        {needs.username && (
          <div>
            <FieldLabel required>Username</FieldLabel>
            <input
              className={inputClass}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="The username this service is issued against"
              aria-label="Username"
            />
          </div>
        )}
      </div>

      {invoiced && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="text-sm font-semibold text-amber-900">
            This period has already been invoiced.
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            The service can still be ended on this date, but the existing invoice will not be
            rewritten automatically. Handle any financial adjustment separately.
          </p>
        </div>
      )}

      {chosenLabel && card.operation_code !== operation && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          The request asked for {card.action_label ?? card.action}. It will be recorded as {chosenLabel}.
        </p>
      )}

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
    </Modal>
  );
};

export default ApplyActionModal;
