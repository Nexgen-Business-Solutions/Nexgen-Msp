import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import ConfirmModal from '@/shared/components/ConfirmModal';
import type { ExecutionPlan, WorkRequirement } from '@/lib/api/internal';
import { useSaveRequiredIdentifiers } from '../../hooks/useRequests';
import { compactBadge, primaryButton, secondaryButton } from '../../lib/workDisplay';

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {children}
  </th>
);

const COPY = {
  username: {
    title: 'Complete required usernames',
    owner: 'Person',
    field: 'Username',
  },
  serial_number: {
    title: 'Complete required serial numbers',
    owner: 'Device',
    field: 'Serial number',
  },
} as const;

type RowState = 'missing' | 'entered' | 'saved' | 'error';

const STATE_BADGE: Record<RowState, { label: string; tone: string }> = {
  missing: { label: 'MISSING', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  entered: { label: 'READY', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  saved: { label: 'SAVED', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  error: { label: 'ERROR', tone: 'border-red-200 bg-red-50 text-red-700' },
};

/**
 * The technical values a customer was never asked for, entered where they become necessary.
 *
 * Whoever is doing the work rarely holds all of them at once, so a row saves on its own and
 * what was saved stays saved. Nothing here keeps a second copy of a username: the Client User
 * owns it, which is why leaving and coming back finds it exactly where it was left.
 */
const requirementsOf = (plan: ExecutionPlan | undefined) => [
  ...(plan?.requirements ?? []),
  ...(plan?.action_groups ?? []).flatMap((group) => group.work.flatMap((card) => card.requirements ?? [])),
];

const RequiredIdentifiersModal: React.FC<{
  request: string;
  kind: 'username' | 'serial_number';
  requirements: WorkRequirement[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ request, kind, requirements, onClose, onSaved }) => {
  const save = useSaveRequiredIdentifiers();
  const [rows] = useState(() => requirements.filter((row) => row.kind === kind && row.owner_name));
  const [values, setValues] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState<Record<string, string | null>>({});
  const [leaving, setLeaving] = useState(false);

  const copy = COPY[kind];
  const dirty = Object.entries(values).filter(([, value]) => value.trim());

  const commit = async (closing: boolean) => {
    if (!dirty.length) {
      if (closing) onClose();
      return;
    }

    let outcome;
    try {
      outcome = await save.mutateAsync({
        request,
        values: dirty.map(([owner, value]) => {
          const requirement = rows.find((row) => row.owner_name === owner);

          return {
            kind,
            owner,
            owner_type: requirement?.owner_type ?? null,
            value: value.trim(),
            modified: owner in fresh ? fresh[owner] : (requirement?.owner_modified ?? null),
          };
        }),
      });
    } catch {
      return;
    }

    const refused: Record<string, string> = {};
    const accepted: Record<string, string> = {};
    for (const row of outcome.results) {
      if (row.ok) accepted[row.owner] = values[row.owner]?.trim() ?? '';
      else refused[row.owner] = row.message ?? 'Could not be saved.';
    }

    const latest = requirementsOf(outcome.plan);
    const stamps: Record<string, string | null> = {};
    for (const owner of Object.keys(accepted)) {
      const row = latest.find((item) => item.kind === kind && item.owner_name === owner);
      if (row) stamps[owner] = row.owner_modified ?? null;
    }

    setFailures(refused);
    setFresh((current) => ({ ...current, ...stamps }));
    setSaved((current) => ({ ...current, ...accepted }));
    setValues((current) => Object.fromEntries(Object.entries(current).filter(([owner]) => refused[owner])));
    if (Object.keys(accepted).length) onSaved();
    if (closing && !Object.keys(refused).length) onClose();
  };

  const stateOf = (owner: string): RowState => {
    if (failures[owner]) return 'error';
    if ((values[owner] ?? '').trim()) return 'entered';
    if (saved[owner]) return 'saved';
    return 'missing';
  };

  const leave = () => (dirty.length ? setLeaving(true) : onClose());

  return (
    <>
      <Modal
        open
        onClose={leave}
        icon={KeyRound}
        tone="amber"
        title={copy.title}
        subtitle="Enter the values you know now. Saved values remain available when you return."
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={leave} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!dirty.length || save.isLoading}
              onClick={() => commit(false)}
              className={secondaryButton}
            >
              Save progress
            </button>
            <button type="button" disabled={save.isLoading} onClick={() => commit(true)} className={primaryButton}>
              Save &amp; continue
            </button>
          </div>
        }
      >
        <div className="space-y-3">
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
              <tbody>
                {rows.map((row) => {
                  const owner = row.owner_name as string;
                  const failed = failures[owner];
                  const state = stateOf(owner);

                  return (
                    <tr key={row.key} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2 text-sm font-semibold text-slate-900">{row.owner_label ?? owner}</td>
                      {kind === 'username' && (
                        <td className="px-3 py-2 text-sm text-slate-600">{row.owner_department ?? '—'}</td>
                      )}
                      <td className="px-3 py-2">
                        <input
                          value={values[owner] ?? saved[owner] ?? ''}
                          aria-label={`${copy.field} for ${row.owner_label ?? owner}`}
                          aria-invalid={failed ? true : undefined}
                          onChange={(event) =>
                            setValues((current) => ({ ...current, [owner]: event.target.value }))
                          }
                          placeholder={copy.field}
                          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-4 ${
                            failed
                              ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
                          }`}
                        />
                        {failed && <p className="mt-1 text-xs font-medium text-red-600">{failed}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`${compactBadge} ${STATE_BADGE[state].tone}`}>{STATE_BADGE[state].label}</span>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
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
            <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
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
