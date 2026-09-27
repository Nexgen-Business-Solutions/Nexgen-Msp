import React, { useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import type { RequestActionGroupSnapshot, RequestSubjectSnapshot } from '@/lib/api/portal';

/** What a card shows of one atomic line, whichever screen the line was read on. */
export type ActionGroupLine = {
  idx: number;
  subject_key?: string | null;
  action_group_key?: string | null;
  action_label?: string | null;
  user_name?: string | null;
  new_user_full_name?: string | null;
  hostname?: string | null;
  service_name?: string | null;
  service_status?: string | null;
};

const quietBtn =
  'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50';

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {children}
  </th>
);

/** The people an act was asked for, or the people it deliberately left alone. */
const Impact: React.FC<{
  title: string;
  rows: { name: string; detail: string }[];
  onClose: () => void;
}> = ({ title, rows, onClose }) => (
  <Modal
    open
    onClose={onClose}
    icon={Users}
    title={title}
    subtitle={`${rows.length} person(s)`}
    widthClass="max-w-2xl"
    footer={
      <div className="flex items-center justify-end">
        <button type="button" onClick={onClose} className={quietBtn}>
          Close
        </button>
      </div>
    }
  >
    <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
      <table className="w-full">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            <Th>Person</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`}>
              <td className="px-3 py-2 text-sm font-medium text-slate-900">{row.name}</td>
              <td className="px-3 py-2 text-sm text-slate-600">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Modal>
);

/**
 * A request read the way it was written: one card per act the customer added.
 *
 * The counts are the ones recorded when the request was raised, never recomputed from
 * today's state — an approver has to see the request they are answering, not a version of
 * it that quietly moved. The atomic lines stay one click away.
 */
const RequestActionGroups: React.FC<{
  groups: RequestActionGroupSnapshot[];
  subjects: RequestSubjectSnapshot[];
  lines: ActionGroupLine[];
  footer?: (group: RequestActionGroupSnapshot) => React.ReactNode;
}> = ({ groups, subjects, lines, footer }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState<{ title: string; rows: { name: string; detail: string }[] } | null>(
    null
  );
  const nameOf = new Map(subjects.map((subject) => [subject.subject_key, subject.full_name]));

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const mine = lines.filter((line) => line.subject_key && nameOf.has(line.subject_key));
        const own = lines.filter((line) => line.action_group_key === group.group_key);
        const detail = own.length ? own : mine;
        const unchanged = group.impact.filter((row) => row.status === 'inapplicable');

        return (
          <section
            key={group.group_key}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {group.operation_label_snapshot}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {group.source_scope_label ?? 'All selected'} · {group.applicable_target_count}{' '}
                  targets from {group.selected_subject_count} selected people
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setReading({
                      title: 'Impacted targets',
                      rows: group.impact
                        .filter((row) => row.status === 'selected')
                        .map((row) => ({
                          name: nameOf.get(row.subject_key) ?? row.subject_key,
                          detail: (row.targets ?? [])
                            .map((target) => target.target)
                            .join(', '),
                        })),
                    })
                  }
                  className={quietBtn}
                >
                  View impacted targets
                </button>

                {unchanged.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setReading({
                        title: 'Unchanged at request time',
                        rows: unchanged.map((row) => ({
                          name: nameOf.get(row.subject_key) ?? row.subject_key,
                          detail: row.reason_code ?? '',
                        })),
                      })
                    }
                    className={quietBtn}
                  >
                    View unchanged
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setOpen(open === group.group_key ? null : group.group_key)}
                  aria-expanded={open === group.group_key}
                  className={quietBtn}
                >
                  <ChevronDown
                    size={13}
                    className={`transition-transform ${open === group.group_key ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
            </div>

            <p className="px-4 py-2.5 text-xs text-slate-600">
              {group.applicable_target_count} will be affected · {group.excluded_subject_count}{' '}
              were left unchanged at request time
            </p>

            {open === group.group_key && (
              <div className="border-t border-slate-100">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Person</Th>
                      <Th>Target</Th>
                      <Th>Requested operation</Th>
                      <Th>State at request time</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.map((line) => (
                      <tr key={`${group.group_key}-${line.idx}`}>
                        <td className="px-3 py-2 text-sm font-medium text-slate-900">
                          {line.user_name ?? line.new_user_full_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-600">
                          {line.hostname ?? line.service_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-600">{line.action_label}</td>
                        <td className="px-3 py-2 text-sm text-slate-600">
                          {line.service_status ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {footer?.(group)}
          </section>
        );
      })}

      {reading && (
        <Impact title={reading.title} rows={reading.rows} onClose={() => setReading(null)} />
      )}
    </div>
  );
};

export default RequestActionGroups;
