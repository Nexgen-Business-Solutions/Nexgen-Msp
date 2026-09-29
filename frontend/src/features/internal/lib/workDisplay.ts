import type {
  ActionWorkGroup,
  ExecutionPerson,
  ExecutionPlan,
  WorkCard,
  WorkDisplayStatus,
  WorkRequirement,
} from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';

export type ExecutionSelection =
  | { kind: 'all' }
  | { kind: 'group'; key: string }
  | { kind: 'person'; key: string };

export const UNRESOLVED_TARGET_EXPLANATION =
  'Resolve this requested target before using its standard detail actions.';

export const SETTLED_STATUSES: WorkDisplayStatus[] = ['Completed', 'Cancelled'];

export const isSettled = (card: WorkCard) => SETTLED_STATUSES.includes(card.display_status);

export const isUnresolvedTarget = (card: WorkCard) =>
  (card.target.kind === 'requested_client_user' || card.target.kind === 'requested_device') &&
  !card.target.name;

export const groupKeyOf = (group: ActionWorkGroup) =>
  group.group_key ?? `${group.origin}:${group.operation_code ?? ''}:${group.label}`;

export const allCards = (plan: ExecutionPlan) => plan.action_groups.flatMap((group) => group.work);

export const countStatuses = (cards: WorkCard[]) => {
  const count = (status: WorkDisplayStatus) =>
    cards.filter((card) => card.display_status === status).length;

  return {
    ready: count('Ready'),
    needsInformation: count('Needs information'),
    waiting: count('Waiting for prerequisite'),
    completed: count('Completed'),
    failed: count('Failed'),
    remaining: cards.filter((card) => !isSettled(card)).length,
  };
};

export const openRequirements = (cards: WorkCard[], kind: WorkRequirement['kind']) => {
  const seen = new Map<string, WorkRequirement>();

  for (const card of cards) {
    if (isSettled(card)) continue;
    for (const requirement of card.requirements ?? []) {
      if (requirement.kind !== kind || requirement.satisfied || seen.has(requirement.key)) continue;
      seen.set(requirement.key, requirement);
    }
  }

  return [...seen.values()];
};

export const STATUS_TONE: Record<WorkDisplayStatus, string> = {
  Ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Needs information': 'border-amber-200 bg-amber-50 text-amber-700',
  'Waiting for prerequisite': 'border-amber-200 bg-amber-50 text-amber-700',
  Completed: 'border-slate-200 bg-slate-100 text-slate-600',
  Failed: 'border-red-200 bg-red-50 text-red-700',
  Cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
  Blocked: 'border-orange-200 bg-orange-50 text-orange-700',
};

export const compactBadge =
  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide';

export const statusBadge =
  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300';

export const prerequisiteButton =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const softButton =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50';

export const fieldInput =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

export type WorkTableRow =
  | { kind: 'entity'; entity: RequestedEntityPresentation }
  | { kind: 'work'; card: WorkCard };

export const entitiesOfCard = (card: WorkCard, entities: RequestedEntityPresentation[]) => {
  const named = (name: string | null | undefined) =>
    name ? entities.find((entity) => entity.name === name) : undefined;
  const found = [
    named(card.requested_client_user),
    named(card.requested_holder_requested_client_user),
    named(card.requested_device),
  ].filter((entity): entity is RequestedEntityPresentation => Boolean(entity));

  return [
    ...found.filter((entity) => entity.kind === 'client_user'),
    ...found.filter((entity) => entity.kind === 'device'),
  ].filter((entity, index, all) => all.findIndex((other) => other.key === entity.key) === index);
};

export const workTableRows = (
  cards: WorkCard[],
  entities: RequestedEntityPresentation[],
  entitiesFirst: boolean
): WorkTableRow[] => {
  const listed = new Set<string>();
  const entityRows = (card: WorkCard): WorkTableRow[] =>
    entitiesOfCard(card, entities)
      .filter((entity) => !listed.has(entity.key) && listed.add(entity.key))
      .map((entity) => ({ kind: 'entity', entity }));

  if (entitiesFirst) {
    const dependencies = cards.flatMap(entityRows);
    const people = dependencies.filter((row) => row.kind === 'entity' && row.entity.kind === 'client_user');
    const machines = dependencies.filter((row) => row.kind === 'entity' && row.entity.kind === 'device');

    return [...people, ...machines, ...cards.map((card): WorkTableRow => ({ kind: 'work', card }))];
  }

  return cards.flatMap((card): WorkTableRow[] => [...entityRows(card), { kind: 'work', card }]);
};

export const involves = (card: WorkCard, person: ExecutionPerson) =>
  card.subject_key === person.subject_key ||
  Boolean(
    person.requested_client_user &&
      [card.requested_client_user, card.requested_holder_requested_client_user].includes(
        person.requested_client_user
      )
  );

export const personTableRows = (
  person: ExecutionPerson,
  cards: WorkCard[],
  entities: RequestedEntityPresentation[]
): WorkTableRow[] => {
  const rows = workTableRows(cards, entities, true);
  const own = entities.find((entity) => entity.name && entity.name === person.requested_client_user);

  if (!own || rows.some((row) => row.kind === 'entity' && row.entity.key === own.key)) return rows;

  return [{ kind: 'entity', entity: own }, ...rows];
};

export const openEntityCount = (rows: WorkTableRow[]) =>
  rows.filter((row) => row.kind === 'entity' && row.entity.status === 'Open').length;

export const goesWith = (entity: RequestedEntityPresentation, cards: WorkCard[]) =>
  entity.name
    ? cards.filter(
        (card) =>
          !isSettled(card) &&
          (entity.kind === 'client_user'
            ? card.requested_client_user === entity.name || card.requested_holder_requested_client_user === entity.name
            : card.requested_device === entity.name)
      )
    : [];

export const waitsFor = (card: WorkCard, entities: RequestedEntityPresentation[]) => {
  const names = entitiesOfCard(card, entities)
    .filter((entity) => entity.status === 'Open')
    .map((entity) => entity.display_name);

  if (!names.length) return null;
  if (names.length === 1) return `Waits for ${names[0]}`;
  return `Waits for ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

const RESOLVED_NOTE: Record<string, string> = {
  'client_user:Create New': 'Created during fulfilment',
  'client_user:Use Existing': 'Existing Client User selected',
  'device:Register New': 'Registered during fulfilment',
  'device:Use Existing': 'Existing Device selected',
};

export const resolvedLine = (entity: RequestedEntityPresentation) => {
  if (!entity.resolved_to) return null;
  const note = RESOLVED_NOTE[`${entity.kind}:${entity.resolved_to.mode ?? ''}`];

  return note ? `${entity.resolved_to.name} · ${note}` : entity.resolved_to.name;
};
