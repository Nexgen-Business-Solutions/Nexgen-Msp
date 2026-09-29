import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import TruncatedNote from '@/shared/components/TruncatedNote';
import Select from '@/shared/components/Select';
import type { RequestedClientUserValues } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import {
  useResolveRequestedClientUser,
  useSaveRequestedClientUser,
  useSelectableClientUsers,
} from '../../hooks/useRequests';
import { useDepartmentOptions } from '../../hooks/useSettings';
import { fieldInput, primaryButton, secondaryButton } from '../../lib/workDisplay';
import { PreparationTabs, RequestedInformation, SelectableRow } from './PreparationParts';

type Props = {
  entity: RequestedEntityPresentation;
  customer: string;
  onClose: () => void;
  onSaved: () => void;
};

type Tab = 'create' | 'existing';

const FIELDS: [keyof RequestedClientUserValues, string][] = [
  ['full_name', 'Full name'],
  ['department', 'Department'],
  ['email', 'Email'],
  ['username', 'Username'],
  ['start_date', 'Start date'],
];

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const initialValues = (entity: RequestedEntityPresentation): Record<string, string> =>
  Object.fromEntries(
    FIELDS.map(([key]) => [
      key,
      text(entity.prepared_values[key]) || text(entity.requested_snapshot[key]),
    ])
  );

const PrepareRequestedClientUserModal: React.FC<Props> = ({ entity, customer, onClose, onSaved }) => {
  const save = useSaveRequestedClientUser();
  const resolve = useResolveRequestedClientUser();
  const departments = useDepartmentOptions(customer);
  const [tab, setTab] = useState<Tab>('create');
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(entity));
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const candidates = useSelectableClientUsers(tab === 'existing' ? customer : null, search);

  const departmentChoices = useMemo(() => {
    const active = departments.data ?? [];
    const current = values.department;
    if (!current || active.some((option) => option.value === current)) return active;
    return [{ value: current, label: current }, ...active];
  }, [departments.data, values.department]);

  const payload = (): RequestedClientUserValues =>
    Object.fromEntries(FIELDS.map(([key]) => [key, values[key]?.trim() || null]));

  const creatable = Boolean(values.full_name?.trim() && values.department?.trim());
  const busy = save.isLoading || resolve.isLoading;
  const error = (resolve.error ?? save.error) as Error | null;

  const set = (key: string, value: string) => {
    setSavedNote(false);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const saveProgress = async () => {
    try {
      await save.mutateAsync({ name: entity.name as string, values: payload() });
      setSavedNote(true);
      onSaved();
    } catch {
      return;
    }
  };

  const saveAndResolve = async () => {
    try {
      if (tab === 'create') {
        await resolve.mutateAsync({ name: entity.name as string, mode: 'create', values: payload() });
      } else {
        await resolve.mutateAsync({
          name: entity.name as string,
          mode: 'existing',
          client_user: chosen as string,
        });
      }
      onSaved();
      onClose();
    } catch {
      return;
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={UserPlus}
      tone="amber"
      title="Prepare requested Client User"
      subtitle="Review what the requester provided, complete what you know, then resolve this requested person by creating a new Client User or selecting an existing one."
      widthClass="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {savedNote && <span className="mr-auto text-xs font-semibold text-emerald-700">Progress saved</span>}
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          {tab === 'create' && (
            <button type="button" onClick={saveProgress} disabled={busy} className={secondaryButton}>
              Save progress
            </button>
          )}
          <button
            type="button"
            onClick={saveAndResolve}
            disabled={busy || (tab === 'create' ? !creatable : !chosen)}
            className={primaryButton}
          >
            Save &amp; resolve
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <RequestedInformation snapshot={entity.requested_snapshot} fields={FIELDS} />

        <PreparationTabs<Tab>
          tabs={[
            ['create', 'Create new'],
            ['existing', 'Use existing'],
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'create' ? (
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel required>Full name</FieldLabel>
                <input
                  className={fieldInput}
                  value={values.full_name}
                  onChange={(event) => set('full_name', event.target.value)}
                />
              </label>
              <div>
                <FieldLabel required>Department</FieldLabel>
                <Select
                  className="w-full"
                  value={values.department}
                  onChange={(value) => set('department', value)}
                  placeholder="Select a department"
                  options={departmentChoices}
                />
              </div>
              <label className="block">
                <FieldLabel>Email</FieldLabel>
                <input
                  type="email"
                  className={fieldInput}
                  value={values.email}
                  onChange={(event) => set('email', event.target.value)}
                />
              </label>
              <label className="block">
                <FieldLabel>Username</FieldLabel>
                <input
                  className={fieldInput}
                  value={values.username}
                  onChange={(event) => set('username', event.target.value)}
                />
              </label>
              <label className="block">
                <FieldLabel>Start date</FieldLabel>
                <input
                  type="date"
                  className={fieldInput}
                  value={values.start_date}
                  onChange={(event) => set('start_date', event.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Only fields required to create the Client User block resolution. Service-specific
              requirements remain on dependent work.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <FieldLabel>Search Client Users</FieldLabel>
              <span className="relative block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${fieldInput} pl-9`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, email, username…"
                />
              </span>
            </label>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              {(candidates.data?.rows ?? []).map((row) => (
                <SelectableRow
                  key={row.name}
                  group={`client-user-${entity.key}`}
                  value={row.name}
                  checked={chosen === row.name}
                  selectable={row.selectable}
                  reason={row.disabled_reason}
                  title={row.full_name}
                  detail={`${row.department ?? 'No department'} · ${row.username || 'No username'}`}
                  badge={row.lifecycle_status.toUpperCase()}
                  onSelect={() => setChosen(row.name)}
                />
              ))}
              {candidates.data && candidates.data.rows.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches.</p>
              )}
              {candidates.isLoading && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
              )}
            </div>
            <TruncatedNote page={candidates.data} />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default PrepareRequestedClientUserModal;
