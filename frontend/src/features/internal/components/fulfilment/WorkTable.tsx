import React from 'react';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import type { ActionWorkGroup, PersonFacts, WorkCard, WorkPrerequisite } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import {
  compactBadge,
  prerequisiteButton,
  primaryButton,
  resolvedLine,
  STATUS_TONE,
  statusBadge,
  UNRESOLVED_TARGET_EXPLANATION,
  waitsFor,
  type WorkTableRow,
} from '../../lib/workDisplay';
import { entityRowMenu, workRowMenu, type WorkRowIntent } from '../../lib/workRowMenu';

type Props = {
  rows: WorkTableRow[];
  entities: RequestedEntityPresentation[];
  groupOf: (card: WorkCard) => ActionWorkGroup | undefined;
  people?: Record<string, PersonFacts>;
  errors: Record<string, string>;
  running: Set<string>;
  onExecute: (card: WorkCard) => void;
  onPrerequisite: (card: WorkCard) => void;
  onPrepare: (entity: RequestedEntityPresentation) => void;
  onCancel: (entity: RequestedEntityPresentation) => void;
  onIntent: (intent: WorkRowIntent) => void;
};

const Th: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th
    className={`whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${className}`}
  >
    {children}
  </th>
);

const newBadge = `${compactBadge} border-amber-200 bg-amber-50 text-amber-700`;

const ROW_PREPARED_KINDS: WorkPrerequisite['kind'][] = [
  'prepare_person',
  'prepare_holder',
  'prepare_device',
  'complete_device_information',
];

const ENTITY_STATUS: Record<RequestedEntityPresentation['status'], { label: string; tone: string }> = {
  Open: { label: 'To do', tone: STATUS_TONE['Waiting for prerequisite'] },
  Resolved: { label: 'Completed', tone: STATUS_TONE.Completed },
  Cancelled: { label: 'Cancelled', tone: STATUS_TONE.Cancelled },
};

const EntityRow: React.FC<{
  entity: RequestedEntityPresentation;
  onPrepare: (entity: RequestedEntityPresentation) => void;
  onCancel: (entity: RequestedEntityPresentation) => void;
}> = ({ entity, onPrepare, onCancel }) => {
  const person = entity.kind === 'client_user';
  const action = person ? 'Create user' : 'Prepare Device';
  const department = person ? entity.requested_snapshot.department : null;
  const resolved = entity.status === 'Resolved' ? resolvedLine(entity) : null;
  const blocked = entity.status === 'Open' && entity.blocked_by ? entity.blocked_by : null;
  const status = blocked ? { label: 'Waiting', tone: STATUS_TONE['Waiting for prerequisite'] } : ENTITY_STATUS[entity.status];

  return (
    <tr data-requested-entity={entity.name ?? entity.key} className="border-b border-slate-100 last:border-b-0">
      <td className="px-3 py-2.5 align-middle">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-900">
          {entity.display_name}
          {person && <span className={newBadge}>NEW</span>}
          {!person && entity.status === 'Open' && <span className={newBadge}>UNRESOLVED</span>}
        </p>
        {typeof department === 'string' && department && (
          <p className="mt-0.5 text-[11px] text-slate-500">{department}</p>
        )}
        {resolved && <p className="mt-0.5 text-[11px] text-slate-500">{resolved}</p>}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <p className="text-xs font-semibold text-slate-900">{action}</p>
      </td>
      <td className="px-3 py-2.5 align-middle text-xs text-slate-700">
        {blocked ? `Waits for ${blocked.label}` : entity.status === 'Cancelled' && entity.cancel_reason ? entity.cancel_reason : '—'}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <span className={`${statusBadge} ${status.tone}`}>{status.label}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex items-center justify-end gap-1.5">
          {entity.status === 'Open' && entity.name && (
            <button
              type="button"
              disabled={Boolean(blocked)}
              onClick={() => onPrepare(entity)}
              className={primaryButton}
            >
              {action}
            </button>
          )}
          <RowActionsMenu actions={entityRowMenu(entity, () => onCancel(entity))} />
        </div>
      </td>
    </tr>
  );
};

const WorkTable: React.FC<Props> = ({
  rows,
  entities,
  groupOf,
  people,
  errors,
  running,
  onExecute,
  onPrerequisite,
  onPrepare,
  onCancel,
  onIntent,
}) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200">
    <table className="w-full min-w-[44rem] border-collapse">
      <thead>
        <tr>
          <Th>Target</Th>
          <Th>Requested action</Th>
          <Th>Requirements / dependency</Th>
          <Th>Status</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          if (row.kind === 'entity') {
            return <EntityRow key={`entity:${row.entity.key}`} entity={row.entity} onPrepare={onPrepare} onCancel={onCancel} />;
          }
          const card = row.card;
          const group = groupOf(card);
          const menu = workRowMenu(card, people, onIntent);
          const error = errors[card.name] ?? (card.display_status === 'Failed' ? card.failure_reason : null);
          const relation = card.relationship;
          const waiting = waitsFor(card, entities);
          const prerequisite =
            card.prerequisite_action && !ROW_PREPARED_KINDS.includes(card.prerequisite_action.kind)
              ? card.prerequisite_action
              : null;

          return (
            <tr key={card.name} data-work-order={card.name} className="border-b border-slate-100 last:border-b-0">
              <td className="px-3 py-2.5 align-middle">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-900">
                  {card.target.label}
                  {card.target.badge && <span className={newBadge}>{card.target.badge}</span>}
                </p>
                {relation ? (
                  <>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                      {relation.from_label ?? 'Unassigned'} → {relation.to_label}
                      {relation.to_is_new && <span className={newBadge}>NEW</span>}
                    </p>
                    {relation.note && <p className="mt-0.5 text-[11px] text-amber-700">{relation.note}</p>}
                  </>
                ) : (
                  card.target.sublabel && <p className="mt-0.5 text-[11px] text-slate-500">{card.target.sublabel}</p>
                )}
              </td>
              <td className="px-3 py-2.5 align-middle">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-900">
                  {group?.label ?? card.action_label ?? card.primary_action.label}
                  {card.origin === 'Technician' && (
                    <span className={`${compactBadge} border-violet-200 bg-violet-50 text-violet-700`}>
                      ADDITIONAL ACTION
                    </span>
                  )}
                </p>
                {group?.scope_label && <p className="mt-0.5 text-[11px] text-slate-500">{group.scope_label}</p>}
              </td>
              <td className="px-3 py-2.5 align-middle text-xs text-slate-700">
                {waiting ?? card.dependency_label ?? '—'}
                {error && (
                  <p role="alert" className="mt-1 text-[11px] font-semibold text-red-700">
                    {error}
                  </p>
                )}
              </td>
              <td className="px-3 py-2.5 align-middle">
                <span className={`${statusBadge} ${STATUS_TONE[card.display_status]}`}>{card.display_status}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={!card.primary_action.enabled || running.has(card.name)}
                    onClick={() => onExecute(card)}
                    className={primaryButton}
                  >
                    {card.primary_action.label}
                  </button>
                  {prerequisite && (
                    <button type="button" onClick={() => onPrerequisite(card)} className={prerequisiteButton}>
                      {prerequisite.label}
                    </button>
                  )}
                  {menu.kind === 'unresolved' ? (
                    <RowActionsMenu actions={[]} disabledReason={UNRESOLVED_TARGET_EXPLANATION} />
                  ) : (
                    <RowActionsMenu actions={menu.actions} />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
              No accepted work in this view.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

export default WorkTable;
