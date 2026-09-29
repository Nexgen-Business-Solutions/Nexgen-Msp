import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { recall, remember } from '@/shared/lib/openingSelection';
import type { ExecutionPlan, PersonFacts, WorkCard, WorkRequirement } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import {
  requestKeys,
  useExecuteWorkOrders,
  useRecordRequestActivity,
  useSettleWorkDoneElsewhere,
} from '../../hooks/useRequests';
import {
  allCards,
  compactBadge,
  countStatuses,
  goesWith,
  groupKeyOf,
  involves,
  openEntityCount,
  personTableRows,
  openRequirements,
  prerequisiteButton,
  primaryButton,
  softButton,
  UNRESOLVED_TARGET_EXPLANATION,
  workTableRows,
  type ExecutionSelection,
} from '../../lib/workDisplay';
import { personMenu, type WorkRowIntent } from '../../lib/workRowMenu';
import CancelRequestedEntityModal from './CancelRequestedEntityModal';
import EffectiveDateModal, { type HandOver } from './EffectiveDateModal';
import ExecutionRail from './ExecutionRail';
import PrepareRequestedClientUserModal from './PrepareRequestedClientUserModal';
import PrepareRequestedDeviceModal from './PrepareRequestedDeviceModal';
import RequiredIdentifiersModal from './RequiredIdentifiersModal';
import WorkRowModals from './WorkRowModals';
import WorkTable from './WorkTable';

type Props = {
  plan: ExecutionPlan;
  people?: Record<string, PersonFacts>;
  onSaved: () => void;
  onContinue: () => void;
};

type Identifiers = { kind: 'username' | 'serial_number'; requirements: WorkRequirement[] };

type Dating = { cards: WorkCard[]; grouped: boolean };

const Counter: React.FC<{ value: number; label: string; tone: string }> = ({ value, label, tone }) =>
  value > 0 ? (
    <span className={`${compactBadge} ${tone}`}>
      {value} {label}
    </span>
  ) : null;

const defaultSelection = (plan: ExecutionPlan): ExecutionSelection => {
  const person = plan.people.find((row) => row.remaining > 0) ?? plan.people[0];

  if (person) return { kind: 'person', key: person.subject_key };

  const open = plan.action_groups.find((group) => countStatuses(group.work).remaining > 0);
  const first = open ?? plan.action_groups[0];

  return first ? { kind: 'group', key: groupKeyOf(first) } : { kind: 'all' };
};

const ExecutionWorkspace: React.FC<Props> = ({ plan, people, onSaved, onContinue }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const execute = useExecuteWorkOrders();
  const recordActivity = useRecordRequestActivity();
  const settleElsewhere = useSettleWorkDoneElsewhere();

  const [picked, setPicked] = useState<ExecutionSelection | null>(null);
  const [identifiers, setIdentifiers] = useState<Identifiers | null>(null);
  const [preparing, setPreparing] = useState<RequestedEntityPresentation | null>(null);
  const [cancelling, setCancelling] = useState<RequestedEntityPresentation | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [intent, setIntent] = useState<WorkRowIntent | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<string | null>(null);
  const [dating, setDating] = useState<Dating | null>(null);

  const cards = useMemo(() => allCards(plan), [plan]);
  const groupByCard = useMemo(() => {
    const map = new Map<string, ExecutionPlan['action_groups'][number]>();
    for (const group of plan.action_groups) for (const card of group.work) map.set(card.name, group);
    return map;
  }, [plan.action_groups]);

  const valid = (selection: ExecutionSelection | null) => {
    if (!selection) return false;
    if (selection.kind === 'all') return true;
    if (selection.kind === 'group') return plan.action_groups.some((group) => groupKeyOf(group) === selection.key);
    return plan.people.some((person) => person.subject_key === selection.key);
  };
  const kept = `msp.request.execution.${plan.request}`;
  const remembered = useMemo(() => recall<ExecutionSelection>(kept), [kept]);
  const selection = valid(picked)
    ? (picked as ExecutionSelection)
    : valid(remembered)
      ? (remembered as ExecutionSelection)
      : defaultSelection(plan);

  const selectedGroup =
    selection.kind === 'group'
      ? plan.action_groups.find((group) => groupKeyOf(group) === selection.key)
      : undefined;
  const selectedPerson =
    selection.kind === 'person' ? plan.people.find((person) => person.subject_key === selection.key) : undefined;

  const view =
    selection.kind === 'group'
      ? (selectedGroup?.work ?? [])
      : selectedPerson
        ? cards.filter((card) => involves(card, selectedPerson))
        : cards;

  const rows = selectedPerson
    ? personTableRows(selectedPerson, view, plan.requested_entities)
    : workTableRows(view, plan.requested_entities, false);
  const counts = countStatuses(view);
  const ready = view.filter((card) => card.display_status === 'Ready' && card.primary_action.enabled);
  const usernames = openRequirements(view, 'username');
  const serials = openRequirements(view, 'serial_number');

  const title = selectedGroup?.label ?? selectedPerson?.full_name ?? 'All remaining work';
  const subtitle = selectedGroup
    ? [selectedGroup.scope_label, `${selectedGroup.total} target${selectedGroup.total === 1 ? '' : 's'}`]
        .filter(Boolean)
        .join(' · ')
    : selectedPerson
      ? [selectedPerson.department, 'all accepted work involving this person'].filter(Boolean).join(' · ')
      : 'Every accepted Work Order';

  const refresh = () => {
    queryClient.invalidateQueries(requestKeys.plan(plan.request));
    queryClient.invalidateQueries(requestKeys.detail(plan.request));
  };

  const run = async (
    batch: WorkCard[],
    summarise: boolean,
    date: string,
    invoiced: Set<string>,
    handOver?: HandOver
  ) => {
    const names = batch.map((card) => card.name);
    setRunning((current) => new Set([...current, ...names]));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !names.includes(key))));
    if (summarise) setOutcome(null);

    try {
      const result = await execute.mutateAsync({
        request: plan.request,
        executions: names.map((work_order) => ({
          work_order,
          inputs: {
            effective_date: date,
            ...(invoiced.has(work_order) ? { confirm_billed: 1 } : {}),
            ...(handOver ?? {}),
          },
        })),
      });
      const refused = result.results.filter((row) => !row.ok && row.work_order);
      setErrors((current) => ({
        ...current,
        ...Object.fromEntries(refused.map((row) => [row.work_order as string, row.message ?? 'Could not be completed.'])),
      }));
      if (result.completed) onSaved();
      if (summarise) {
        setOutcome(
          result.failed ? `${result.completed} completed · ${result.failed} failed` : `${result.completed} completed`
        );
      }
    } catch (error) {
      const message = (error as Error).message;
      setErrors((current) => ({ ...current, ...Object.fromEntries(names.map((name) => [name, message])) }));
    } finally {
      setRunning((current) => new Set([...current].filter((name) => !names.includes(name))));
    }
  };

  const entityNamed = (name: string | null) =>
    name ? plan.requested_entities.find((entity) => entity.name === name) ?? null : null;

  const onPrerequisite = (card: WorkCard) => {
    const prerequisite = card.prerequisite_action;
    if (!prerequisite) return;
    switch (prerequisite.kind) {
      case 'complete_username':
        setIdentifiers({ kind: 'username', requirements: openRequirements([card], 'username') });
        return;
      case 'complete_serial':
        setIdentifiers({ kind: 'serial_number', requirements: openRequirements([card], 'serial_number') });
        return;
      case 'prepare_person':
      case 'prepare_holder':
      case 'prepare_device':
      case 'complete_device_information': {
        const entity = entityNamed(prerequisite.requested_entity);
        if (entity) setPreparing(entity);
      }
    }
  };

  const onIntent = (next: WorkRowIntent) => {
    if (next.kind === 'deviceOpen') {
      navigate(`/msp/devices/${next.device}`);
      return;
    }
    setIntent(next);
  };

  const personActions =
    selectedPerson && view[0]
      ? personMenu(selectedPerson.client_user ?? '', view[0], people, onIntent)
      : null;

  const closeIntent = () => {
    setIntent(null);
    refresh();
    settleElsewhere.mutate(plan.request);
  };

  const pendingByPerson = Object.fromEntries(
    plan.people.map((person) => [
      person.subject_key,
      openEntityCount(
        personTableRows(
          person,
          cards.filter((card) => involves(card, person)),
          plan.requested_entities
        )
      ),
    ])
  );
  const executed = plan.stages.current !== 'execute';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <ExecutionRail
          groups={plan.action_groups}
          people={plan.people}
          remaining={countStatuses(cards).remaining + openEntityCount(workTableRows(cards, plan.requested_entities, false))}
          pendingByPerson={pendingByPerson}
          selection={selection}
          onSelect={(next) => {
            setPicked(next);
            remember(kept, next);
            setOutcome(null);
          }}
        />

        <section aria-label="Execution workspace" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Counter value={counts.ready} label="ready" tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
                <Counter value={counts.needsInformation} label="need information" tone="border-amber-200 bg-amber-50 text-amber-700" />
                <Counter value={counts.waiting} label="waiting for prerequisite" tone="border-amber-200 bg-amber-50 text-amber-700" />
                <Counter value={counts.completed} label="completed" tone="border-slate-200 bg-white text-slate-600" />
                <Counter value={counts.failed} label="failed" tone="border-red-200 bg-red-50 text-red-700" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setTargetsOpen(true)} className={softButton}>
                View targets
              </button>
              {selectedPerson && personActions?.kind === 'client_user' && (
                <RowActionsMenu actions={personActions.actions} />
              )}
              {selectedPerson && personActions?.kind === 'unresolved' && (
                <RowActionsMenu actions={[]} disabledReason={UNRESOLVED_TARGET_EXPLANATION} />
              )}
            </div>
          </div>

          <div className="space-y-2.5 p-3.5">
            {(ready.length > 0 || usernames.length > 0 || serials.length > 0) && (
              <section
                aria-label="Grouped execution"
                className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2"
              >
                <p className="text-xs font-bold text-slate-900">Grouped execution</p>
                <div className="flex flex-wrap gap-1.5">
                  {ready.length > 0 && (
                    <button
                      type="button"
                      disabled={execute.isLoading}
                      onClick={() => setDating({ cards: ready, grouped: true })}
                      className={primaryButton}
                    >
                      Execute {ready.length} ready
                    </button>
                  )}
                  {usernames.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIdentifiers({ kind: 'username', requirements: usernames })}
                      className={prerequisiteButton}
                    >
                      Complete {usernames.length} usernames
                    </button>
                  )}
                  {serials.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIdentifiers({ kind: 'serial_number', requirements: serials })}
                      className={prerequisiteButton}
                    >
                      Complete {serials.length} serial numbers
                    </button>
                  )}
                </div>
              </section>
            )}

            {outcome && (
              <p
                role="status"
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  outcome.includes('failed')
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {outcome}
              </p>
            )}

            <WorkTable
              rows={rows}
              entities={plan.requested_entities}
              groupOf={(card) => groupByCard.get(card.name)}
              people={people}
              errors={errors}
              running={running}
              onExecute={(card) => setDating({ cards: [card], grouped: false })}
              onPrerequisite={onPrerequisite}
              onPrepare={setPreparing}
              onCancel={setCancelling}
              onIntent={onIntent}
            />

            {plan.rejected.length > 0 && (
              <p className="text-xs text-slate-500">
                {plan.rejected.length} rejected line{plan.rejected.length > 1 ? 's are' : ' is'} not part of the work.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-col items-stretch justify-end gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center">
        <button type="button" disabled={!executed} onClick={onContinue} className={primaryButton}>
          Continue to Verify
        </button>
      </div>

      {targetsOpen && (
        <Modal
          open
          onClose={() => setTargetsOpen(false)}
          icon={ListChecks}
          title="Targets in this view"
          subtitle={`${view.length} Work Order target${view.length === 1 ? '' : 's'}`}
          widthClass="max-w-3xl"
          footer={
            <div className="flex justify-end">
              <button type="button" onClick={() => setTargetsOpen(false)} className={primaryButton}>
                Done
              </button>
            </div>
          }
        >
          <table className="w-full">
            <thead>
              <tr>
                {['Target', 'Action', 'Status'].map((label) => (
                  <th
                    key={label}
                    className="border-b border-slate-200 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((card) => (
                <tr key={card.name} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5 text-xs text-slate-800">{card.target.label}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">
                    {groupByCard.get(card.name)?.label ?? card.primary_action.label}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">{card.display_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {dating && (
        <EffectiveDateModal
          title={dating.grouped ? `Execute ${dating.cards.length} ready` : dating.cards[0].primary_action.label}
          subtitle={
            dating.grouped
              ? `${dating.cards.length} work order${dating.cards.length === 1 ? '' : 's'}`
              : dating.cards[0].target.label
          }
          cards={dating.cards}
          requestedDate={plan.context.requested_date}
          createdOn={plan.context.raised_at}
          busy={execute.isLoading}
          customer={plan.customer}
          grouped={dating.grouped}
          onClose={() => setDating(null)}
          onConfirm={async (date, invoiced, handOver) => {
            await run(dating.cards, dating.grouped, date, invoiced, handOver);
            setDating(null);
          }}
        />
      )}

      {preparing?.kind === 'client_user' && (
        <PrepareRequestedClientUserModal
          entity={preparing}
          customer={plan.customer}
          onSaved={onSaved}
          onClose={() => setPreparing(null)}
        />
      )}

      {preparing?.kind === 'device' && (
        <PrepareRequestedDeviceModal
          entity={preparing}
          customer={plan.customer}
          onSaved={onSaved}
          onClose={() => setPreparing(null)}
        />
      )}

      {cancelling && (
        <CancelRequestedEntityModal
          entity={cancelling}
          goesWith={goesWith(cancelling, cards).map((card) => ({
            key: card.name,
            action: groupByCard.get(card.name)?.label ?? card.action_label ?? card.primary_action.label,
            target: card.target.label,
          }))}
          onSaved={onSaved}
          onClose={() => setCancelling(null)}
        />
      )}

      {identifiers && (
        <RequiredIdentifiersModal
          request={plan.request}
          kind={identifiers.kind}
          requirements={identifiers.requirements}
          onSaved={onSaved}
          onClose={() => setIdentifiers(null)}
        />
      )}

      <WorkRowModals
        intent={intent}
        request={plan.request}
        customer={plan.customer}
        people={people}
        onClose={closeIntent}
        onActivity={(subjectKey, activity) =>
          recordActivity.mutate({
            name: plan.request,
            subject_key: subjectKey,
            label: activity.label,
            detail: activity.detail,
          })
        }
      />
    </div>
  );
};

export default ExecutionWorkspace;
