import React, { useState } from 'react';
import { Laptop, Search, Trash2, UserPlus, Users } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useNewUserRequestContext, useRequestSubjectContext, useRequestUserSearch } from '../hooks/usePortal';
import type { RequestSubject, useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

/** Who the request is about, shown as they actually are rather than as a name in a box. */
const IdentityCard: React.FC<{ subject: RequestSubject; onRemove: () => void }> = ({
  subject,
  onRemove,
}) => {
  const context = useRequestSubjectContext(subject.clientUser);
  const devices = context.data?.devices ?? [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">{subject.fullName}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[subject.department, subject.email].filter(Boolean).join(' · ')}
          </p>
          {context.data && (
            <p className="mt-1 text-xs text-slate-500">
              Status: {context.data.user.lifecycle_status}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${subject.fullName}`}
          className="rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {devices.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Devices</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {devices.map((device) => (
              <div key={device.name} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Laptop size={13} className="text-slate-400" />
                  {device.hostname}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {device.serial_number ? `Serial: ${device.serial_number}` : 'Serial: not recorded'}
                </p>
                {device.device_type && (
                  <p className="text-xs text-slate-500">{device.device_type}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const NewPersonCard: React.FC<{ subject: RequestSubject; builder: Builder }> = ({
  subject,
  builder,
}) => {
  const context = useNewUserRequestContext();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold text-slate-900">New person</p>
        <button
          type="button"
          onClick={() => builder.removeSubject(subject.key)}
          aria-label="Remove new person"
          className="rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel required>Full name</FieldLabel>
          <input
            className={inputClass}
            value={subject.fullName ?? ''}
            onChange={(event) =>
              builder.updateSubject(subject.key, { fullName: event.target.value })
            }
            placeholder="Marie Dupont"
          />
        </div>
        <div>
          <FieldLabel required>Department</FieldLabel>
          <Select
            searchable
            className="w-full"
            value={subject.department ?? ''}
            onChange={(value) => builder.updateSubject(subject.key, { department: value })}
            placeholder="Select department"
            options={(context.data?.departments ?? []).map((row) => ({
              value: row.value,
              label: row.label,
            }))}
          />
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <input
            className={inputClass}
            value={subject.email ?? ''}
            onChange={(event) => builder.updateSubject(subject.key, { email: event.target.value })}
            placeholder="marie@company.com"
          />
        </div>
      </div>

      {/* nobody is asked for an account name, but a customer who already knows it saves
          the technician a phone call */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <FieldLabel>Username (optional)</FieldLabel>
        <input
          className={`${inputClass} max-w-sm`}
          value={subject.username ?? ''}
          onChange={(event) => builder.updateSubject(subject.key, { username: event.target.value })}
          placeholder="Leave empty if you do not know it"
        />
      </div>
    </div>
  );
};

const RequestSubjectStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const [search, setSearch] = useState('');
  const results = useRequestUserSearch(search);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Who is this request for?</p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FieldLabel>Existing user</FieldLabel>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search a user by name, email or department"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => builder.addNewSubject()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <UserPlus size={15} />
            New user
          </button>
        </div>

        {search.trim().length > 0 && (
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200">
            {(results.data ?? []).length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-500">Nobody matches that.</p>
            )}
            {(results.data ?? []).map((person) => (
              <button
                key={person.name}
                type="button"
                onClick={() => {
                  builder.addExistingSubject(person);
                  setSearch('');
                }}
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

      {builder.subjects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          <Users size={16} className="mr-1.5 inline text-slate-400" />
          Pick the person this request is about, or add a new one.
        </p>
      ) : (
        <div className="space-y-3">
          {builder.subjects.map((subject) =>
            subject.kind === 'existing' ? (
              <IdentityCard
                key={subject.key}
                subject={subject}
                onRemove={() => builder.removeSubject(subject.key)}
              />
            ) : (
              <NewPersonCard key={subject.key} subject={subject} builder={builder} />
            )
          )}
        </div>
      )}
    </div>
  );
};

export default RequestSubjectStep;
