import type { ReactNode } from 'react';
import { Quote } from 'lucide-react';
import StatusBadge from './StatusBadge';

/** One request line, seen from the person it is about — the same shape on both sides. */
export type PersonLine = {
  idx: number;
  /** The record the line names, directly or through the machine they hold. */
  person: string | null;
  personName: string | null;
  isNewUser: boolean;
  username: string | null;
  department: string | null;
  email: string | null;
  needsPortalAccess: boolean;
  action: string;
  actionLabel: string | null;
  service: string;
  onDevice: boolean;
  isNewDevice: boolean;
  deviceName: string | null;
  serial: string | null;
  deviceType: string | null;
  requestedFor: string | null;
  status: string;
  comment: string | null;
  rejectionReason: string | null;
  /** Anything else worth a line under the service: a rate, a delivery. */
  extra?: ReactNode;
};

export type PersonGroup = { key: string; lines: PersonLine[]; first: PersonLine };

type Props = {
  lines: PersonLine[];
  noteLabel?: string;
  /** Buttons for the person: open, create, register. */
  headerActions?: (group: PersonGroup) => ReactNode;
  /** Buttons for one service: approve, reject. Adds a column when given. */
  rowActions?: (line: PersonLine) => ReactNode;
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '—');

/** The person a line is about: named directly, through the machine they hold, or not yet created. */
const personKey = (line: PersonLine) =>
  line.person ||
  (line.isNewUser ? `new:${line.personName ?? ''}` : `device:${line.deviceName || line.idx}`);

/** One card per person, the way the customer wrote it: their services together, in order. */
const groupLines = (lines: PersonLine[]): PersonGroup[] => {
  const groups = new Map<string, PersonLine[]>();

  for (const line of lines) {
    const key = personKey(line);
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }

  return [...groups.entries()].map(([key, rows]) => ({ key, lines: rows, first: rows[0] }));
};

/** A value every line of the card agrees on, or nothing — then each row says its own. */
const shared = <T,>(lines: PersonLine[], pick: (line: PersonLine) => T) =>
  lines.every((line) => pick(line) === pick(lines[0])) ? pick(lines[0]) : undefined;

const Fact = ({ label, value }: { label: string; value?: string | null }) => (
  <span className="text-xs text-slate-500">
    <span className="text-slate-400">{label}</span>{' '}
    <span className="font-medium text-slate-700">{value || '—'}</span>
  </span>
);

const Tag = ({ children }: { children: ReactNode }) => (
  <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
    {children}
  </span>
);

const th = 'px-4 py-2 font-semibold';
const td = 'px-4 py-3 text-slate-700';

export default function RequestLinesByPerson({
  lines,
  noteLabel = 'Customer note',
  headerActions,
  rowActions,
}: Props) {
  return (
    <div className="space-y-4">
      {groupLines(lines).map((group) => {
        const { first } = group;
        // a machine nobody holds is a card of its own, named after the machine
        const machineOnly = !first.personName && !first.isNewUser && first.onDevice;
        const wantsPortal = group.lines.some((line) => line.needsPortalAccess);

        // what every service of this person has in common is said once, up top
        const action = shared(group.lines, (line) => line.actionLabel || line.action);
        const requestedFor = shared(group.lines, (line) => line.requestedFor);
        const status = shared(group.lines, (line) => line.status);
        const note = shared(group.lines, (line) => line.comment);
        const actions = headerActions?.(group);

        return (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {machineOnly ? first.deviceName || 'Unassigned machine' : first.personName || 'N/A'}
                  {!machineOnly && (
                    <Tag>
                      {first.isNewUser ? 'New user' : 'Existing user'}
                    </Tag>
                  )}
                  {wantsPortal && <Tag>Portal access</Tag>}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {!machineOnly && <Fact label="Username" value={first.username} />}
                  {!machineOnly && <Fact label="Department" value={first.department} />}
                  {first.isNewUser && first.email && <Fact label="Email" value={first.email} />}
                  {action !== undefined && <Fact label="Action" value={action} />}
                  {requestedFor !== undefined && (
                    <Fact label="Requested for" value={fmtDate(requestedFor)} />
                  )}
                  {status !== undefined && (
                    <span className="text-xs text-slate-500">
                      <span className="text-slate-400">Status</span> <StatusBadge value={status} />
                    </span>
                  )}
                </div>
              </div>

              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>

            {note && (
              <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <Quote size={13} className="mt-0.5 shrink-0 text-slate-400" />
                <p className="text-sm text-slate-700">
                  <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {noteLabel}
                  </span>
                  {note}
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className={th}>#</th>
                    <th className={th}>Service</th>
                    {action === undefined && <th className={th}>Action</th>}
                    <th className={th}>Device</th>
                    <th className={th}>Serial number</th>
                    <th className={th}>Type</th>
                    {requestedFor === undefined && <th className={th}>Requested for</th>}
                    {status === undefined && <th className={th}>Status</th>}
                    {rowActions && <th className={th} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.lines.map((line) => (
                    <tr key={line.idx} className="align-top">
                      <td className="px-4 py-3 text-xs font-bold text-slate-400 tabular-nums">
                        {line.idx}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{line.service}</p>
                        {line.extra}
                        {note === undefined && line.comment && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            <Quote size={11} className="mr-1 inline text-slate-400" />
                            {line.comment}
                          </p>
                        )}
                        {line.rejectionReason && (
                          <p className="mt-0.5 text-xs text-red-700">
                            Declined — {line.rejectionReason}
                          </p>
                        )}
                      </td>
                      {action === undefined && (
                        <td className={td}>
                          <StatusBadge value={line.action} />
                          {line.actionLabel && line.actionLabel !== line.action && (
                            <span className="ml-1.5 text-xs text-slate-500">{line.actionLabel}</span>
                          )}
                        </td>
                      )}
                      <td className={td}>
                        {line.onDevice ? (
                          <>
                            <span>{line.deviceName || '—'}</span>
                            <Tag>
                              {line.isNewDevice ? 'New device' : 'Existing device'}
                            </Tag>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={td}>{line.onDevice ? line.serial || '—' : '—'}</td>
                      <td className={td}>{line.onDevice ? line.deviceType || '—' : '—'}</td>
                      {requestedFor === undefined && <td className={td}>{fmtDate(line.requestedFor)}</td>}
                      {status === undefined && (
                        <td className="px-4 py-3">
                          <StatusBadge value={line.status} />
                        </td>
                      )}
                      {rowActions && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">{rowActions(line)}</div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
