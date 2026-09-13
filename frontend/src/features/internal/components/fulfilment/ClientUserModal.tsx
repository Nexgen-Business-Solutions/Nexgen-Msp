import React, { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useExecuteUserSetup } from '../../hooks/useRequests';
import { inputClass } from '../../lib/fulfilmentStyles';

type Props = {
  card: WorkCard | null;
  person: SubjectWorkGroup['person'];
  onClose: () => void;
};

/** The managed person the request needs, created once. Never an account, never an invitation. */
const ClientUserModal: React.FC<Props> = ({ card, person, onClose }) => {
  const create = useExecuteUserSetup();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (!card) return;
    setEmail(person?.email ?? '');
    setUsername(person?.username ?? '');
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const submit = async () => {
    if (!card) return;
    try {
      await create.mutateAsync({
        work_order: card.name,
        email: email.trim() || undefined,
        username: username.trim() || undefined,
      });
      onClose();
    } catch {
      // shown below
    }
  };

  return (
    <Modal
      open={Boolean(card)}
      onClose={onClose}
      icon={UserPlus}
      tone="emerald"
      title="Create Client User"
      subtitle="Complete the managed-person information before running what depends on it."
      widthClass="max-w-xl"
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
            onClick={submit}
            disabled={create.isLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {create.isLoading ? 'Creating…' : 'Create Client User'}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Full name</FieldLabel>
          <input className={`${inputClass} bg-slate-50`} readOnly value={person?.full_name ?? ''} />
        </div>
        <div>
          <FieldLabel>Department</FieldLabel>
          <input className={`${inputClass} bg-slate-50`} readOnly value={person?.department ?? ''} />
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <input
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            aria-label="Email"
          />
        </div>
        <div>
          <FieldLabel>Account name</FieldLabel>
          <input
            className={inputClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Optional"
            aria-label="Account name"
          />
        </div>
      </div>

      {person?.department_retired && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {person.department} is no longer offered for new people. It was agreed when this request
          was approved, so you can still go ahead.
        </p>
      )}

      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        This creates an MSP Client User only. No portal account is created.
      </p>

      {create.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {create.error.message}
        </p>
      )}
    </Modal>
  );
};

export default ClientUserModal;
