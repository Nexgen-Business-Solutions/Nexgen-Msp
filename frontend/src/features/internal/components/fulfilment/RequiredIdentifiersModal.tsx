import React, { useMemo, useState } from 'react';
import { KeyRound, Search } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import ConfirmModal from '@/shared/components/ConfirmModal';
import type { WorkRequirement } from '@/lib/api/internal';
import { useSaveRequiredIdentifiers } from '../../hooks/useRequests';

const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';
const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {children}
  </th>
);

const COPY = {
  username: {
    title: 'Complete required usernames',
    subtitle: (count: number) =>
      `${count} people need a username before this work can run. Enter the values you know now; you can save and return later.`,
    owner: 'Person',
    field: 'Username',
    placeholder: 'Username',
  },
  serial_number: {
    title: 'Complete required serial numbers',
    subtitle: () =>
      'These Devices need a serial number before Device-scoped service work can run.',
    owner: 'Device',
    field: 'Serial number',
    placeholder: 'Serial number',
  },
} as const;

/**
 * The technical values a customer was never asked for, entered where they become necessary.
 *
 * Whoever is doing the work rarely holds all of them at once, so a row saves on its own and
 * what was saved stays saved. Nothing here keeps a second copy of a username: the Client User
 * owns it, which is why leaving and coming back finds it exactly where it was left.
 */
const RequiredIdentifiersModal: React.FC<{
  request: string;
  kind: 'username' | 'serial_number';
  requirements: WorkRequirement[];
  onClose: () => void;
}> = ({ request, kind, requirements, onClose }) => {
  const save = useSaveRequiredIdentifiers();
  const [values, setValues] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [leaving, setLeaving] = useState(false);

  const copy = COPY[kind];
  // what was asked when the dialog opened; a row that saves leaves the plan behind it
  const [opened] = useState(() => requirements.filter((row) => row.kind === kind && !row.satisfied));
  const owed = new Set(
    requirements.filter((row) => row.kind === kind && !row.satisfied).map((row) => row.key)
  );
  const mine = opened.filter((row) => owed.has(row.key));
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (!needle) return mine;

    return mine.filter((row) =>
      `${row.owner_label ?? ''} ${row.owner_department ?? ''}`.toLowerCase().includes(needle)
    );
  }, [mine, search]);

  const dirty = Object.entries(values).filter(([, value]) => value.trim());
  const total = opened.length;
  const done = total - mine.length;
  const complete = dirty.length >= mine.length && mine.length > 0;

  const commit = async () => {
    setFailures({});

    const outcome = await save.mutateAsync({
      request,
      values: dirty.map(([owner, value]) => ({
        kind,
        owner,
        value: value.trim(),
        modified: mine.find((row) => row.owner_name === owner)?.owner_modified ?? null,
      })),
    });
    const refused: Record<string, string> = {};

    for (const row of outcome.results) {
      if (!row.ok) refused[row.owner] = row.message ?? 'Could not be saved.';
    }

    setFailures(refused);
    setValues((current) =>
      Object.fromEntries(Object.entries(current).filter(([owner]) => refused[owner]))
    );

    if (!Object.keys(refused).length) onClose();
  };

  return (
    <>
      <Modal
        open
        onClose={() => (dirty.length ? setLeaving(true) : onClose())}
        icon={KeyRound}
        title={copy.title}
        subtitle={copy.subtitle(mine.length)}
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span role="status" className="text-xs text-slate-500">
              {done} of {total} completed
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (dirty.length ? setLeaving(true) : onClose())}
                className={quietBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!dirty.length || save.isLoading}
                onClick={commit}
                className={primaryBtn}
              >
                {complete ? 'Save & continue' : 'Save progress'}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search people"
              placeholder="Search people…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <Th>{copy.owner}</Th>
                  {kind === 'username' && <Th>Department</Th>}
                  <Th>{copy.field}</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((row) => {
                  const owner = row.owner_name as string;
                  const failed = failures[owner];

                  return (
                    <tr key={row.key}>
                      <td className="px-3 py-2 text-sm font-medium text-slate-900">
                        {row.owner_label ?? owner}
                      </td>
                      {kind === 'username' && (
                        <td className="px-3 py-2 text-sm text-slate-600">
                          {row.owner_department ?? '—'}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <input
                          value={values[owner] ?? ''}
                          aria-label={`${copy.field} for ${row.owner_label ?? owner}`}
                          aria-describedby={failed ? `refused-${owner}` : undefined}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [owner]: event.target.value }))
                          }
                          placeholder={copy.placeholder}
                          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-4 ${
                            failed
                              ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
                          }`}
                        />
                        {failed && (
                          <p id={`refused-${owner}`} className="mt-1 text-xs font-medium text-red-600">
                            {failed}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            failed
                              ? 'bg-red-50 text-red-700'
                              : (values[owner] ?? '').trim()
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {failed ? 'Error' : (values[owner] ?? '').trim() ? 'Ready' : 'Needs setup'}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">
                      Nothing left to complete here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {save.error instanceof Error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
              {save.error.message}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={leaving}
        title="Discard unsaved changes?"
        description="Values that were already saved will be kept. Unsaved fields in this dialog will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          onClose();
        }}
      />
    </>
  );
};

export default RequiredIdentifiersModal;
