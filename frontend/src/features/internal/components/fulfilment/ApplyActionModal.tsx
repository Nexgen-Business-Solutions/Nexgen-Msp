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
  /** the act the technician chose, when it is not the one written on the line */
  action?: string | null;
  onClose: () => void;
};

const LABEL: Record<string, string> = { Suspend: 'Suspend', Resume: 'Resume', Change: 'Change', Remove: 'Close' };

/** What a service act needs to run: the day it takes effect, and the one fact it is issued against. */
const ApplyActionModal: React.FC<Props> = ({ card, person, action, onClose }) => {
  const run = useExecuteServiceAction();
  const [date, setDate] = useState('');
  const [username, setUsername] = useState('');
  const [serial, setSerial] = useState('');
  const [replacement, setReplacement] = useState('');

  const act = action || card?.action || '';
  const changing = act === 'Change';
  const onMachine = card?.target_scope === 'Device';
  const userOffers = useUserServiceAvailability(changing && !onMachine ? (person?.name ?? undefined) : undefined);
  const machineOffers = useDeviceServiceAvailability(changing && onMachine ? card?.managed_device : null);
  const offers = (onMachine ? machineOffers.data : userOffers.data)?.available ?? [];
  const chosenLabel = action ? (LABEL[action] ?? action) : null;

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
  const needs = action ? { username: false, serial: false } : identifiersMissing(card, person);
  const label = chosenLabel ?? card.action_label ?? card.action;

  const submit = async () => {
    try {
      await run.mutateAsync({
        work_order: card.name,
        effective_date: date || undefined,
        action: action && action !== card.action ? action : undefined,
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
            disabled={run.isLoading || (needs.username && !username.trim()) || (needs.serial && !serial.trim()) || (changing && !!action && !replacement)}
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
        {changing && action && (
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
              placeholder="The name on the licence"
              aria-label="Username"
            />
          </div>
        )}
      </div>

      {chosenLabel && card.action !== action && (
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
