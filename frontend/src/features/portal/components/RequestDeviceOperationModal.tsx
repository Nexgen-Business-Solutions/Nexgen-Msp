import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Search, Undo2, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useRequestUserSearch } from '../hooks/usePortal';
import type { RequestSeed } from '../hooks/useRequestBuilder';

type Props = {
  code: 'device.assign' | 'device.transfer' | 'device.repossess';
  label: string;
  device: { name: string; hostname: string; serial_number: string | null };
  currentHolder: string | null;
  currentHolderName: string | null;
  onClose: () => void;
  /** the draft this act becomes: the machine itself is left exactly as it is */
  onContinue: (seed: RequestSeed) => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const COPY = {
  'device.assign': {
    icon: UserPlus,
    title: 'Request device assignment',
    subtitle:
      'The Device remains unassigned until Nexgen approves and performs the assignment.',
    needsHolder: true,
  },
  'device.transfer': {
    icon: ArrowRightLeft,
    title: 'Request holder change',
    subtitle:
      'The current holder stays unchanged until Nexgen approves and performs the transfer.',
    needsHolder: true,
  },
  'device.repossess': {
    icon: Undo2,
    title: 'Request return to stock',
    subtitle:
      'The current holder keeps the Device until Nexgen approves and performs the return.',
    needsHolder: false,
  },
} as const;

/** What a customer asks of a machine, written as a request rather than done to the machine. */
const RequestDeviceOperationModal: React.FC<Props> = ({
  code,
  label,
  device,
  currentHolder,
  currentHolderName,
  onClose,
  onContinue,
}) => {
  const copy = COPY[code];
  const [search, setSearch] = useState('');
  const [holder, setHolder] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const people = useRequestUserSearch(copy.needsHolder ? search : undefined);

  useEffect(() => {
    setHolder('');
    setDate('');
    setNote('');
    setSearch('');
  }, [code, device.name]);

  const choices = (people.data ?? []).filter((person) => person.name !== currentHolder);
  const chosen = choices.find((person) => person.name === holder);
  // an assignment is asked for the person taking the machine; a return, for the one giving it up
  const subject = copy.needsHolder
    ? chosen && { clientUser: chosen.name, fullName: chosen.full_name, department: chosen.department }
    : currentHolder && {
        clientUser: currentHolder,
        fullName: currentHolderName || currentHolder,
      };

  return (
    <Modal
      open
      onClose={onClose}
      icon={copy.icon}
      tone="blue"
      title={copy.title}
      subtitle={copy.subtitle}
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!subject}
            onClick={() =>
              subject &&
              onContinue({
                operationCode: code,
                actionLabel: label,
                managedDevice: device.name,
                deviceLabel: device.hostname,
                subject,
                requestedHolder: copy.needsHolder ? holder : undefined,
                requestedHolderLabel: copy.needsHolder ? chosen?.full_name : undefined,
                currentHolder: currentHolder ?? undefined,
                currentHolderLabel: currentHolderName ?? undefined,
                requestedEffectiveDate: date || undefined,
                comment: note.trim() || undefined,
              })
            }
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue to request
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-400">DEVICE</p>
          <p className="text-sm font-semibold text-slate-900">{device.hostname}</p>
          {device.serial_number && (
            <p className="mt-0.5 text-xs text-slate-500">{device.serial_number}</p>
          )}
          <p className="mt-2 text-xs font-semibold text-slate-400">CURRENT HOLDER</p>
          <p className="text-sm text-slate-700">
            {currentHolderName || currentHolder || 'Unassigned'}
          </p>
        </div>

        {copy.needsHolder && (
          <div>
            <FieldLabel required>New holder</FieldLabel>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className={`${inputClass} pl-9`}
                value={chosen ? chosen.full_name : search}
                onChange={(event) => {
                  setHolder('');
                  setSearch(event.target.value);
                }}
                placeholder="Search a user by name, email or department"
                aria-label="New holder"
              />
            </div>

            {!chosen && (
              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200">
                {choices.length === 0 && (
                  <p className="px-3 py-3 text-sm text-slate-500">Nobody matches that.</p>
                )}
                {choices.map((person) => (
                  <button
                    key={person.name}
                    type="button"
                    onClick={() => setHolder(person.name)}
                    className="flex w-full items-baseline justify-between gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-900">{person.full_name}</span>
                    <span className="text-xs text-slate-500">
                      {[person.email, person.department].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <FieldLabel>Requested date</FieldLabel>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Requested date"
          />
        </div>

        <div>
          <FieldLabel>Note</FieldLabel>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything Nexgen should know about this change."
            aria-label="Note"
          />
        </div>
      </div>
    </Modal>
  );
};

export default RequestDeviceOperationModal;
