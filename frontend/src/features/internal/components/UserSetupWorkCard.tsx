import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useExecuteUserSetup } from '../hooks/useRequests';
import WorkCardShell from './WorkCardShell';

const inputClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500';

/** Opening the account, in the request. No modal, no other page, no second person created. */
const UserSetupWorkCard: React.FC<{ card: WorkCard; person: SubjectWorkGroup['person'] }> = ({
  card,
  person,
}) => {
  const [username, setUsername] = useState(person?.username ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const create = useExecuteUserSetup();

  return (
    <WorkCardShell
      card={card}
      title="User setup"
      subtitle={
        <>
          {person?.full_name}
          {person?.department ? ` · ${person.department}` : ''}
          {card.status === 'Completed' && card.resulting_client_user
            ? ` · ${card.resulting_client_user}`
            : ''}
        </>
      }
    >
      {person?.department_retired && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {person.department} is no longer offered for new people. It was agreed when this
          request was approved, so you can still go ahead.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Account name</FieldLabel>
          <input
            className={inputClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="The name the licence is issued against"
          />
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <input
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="marie@company.com"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={create.isLoading}
        onClick={() =>
          create.mutate({
            work_order: card.name,
            username: username.trim() || undefined,
            email: email.trim() || undefined,
          })
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
      >
        <UserPlus size={15} />
        Create user
      </button>
    </WorkCardShell>
  );
};

export default UserSetupWorkCard;
