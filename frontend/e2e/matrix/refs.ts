import { matrix } from './ground';
import type {
  Act,
  AssignAct,
  Change,
  DateSpec,
  FutureSpec,
  MachineRef,
  NewMachineSpec,
  PeopleStep,
  Ref,
  Scenario,
  ServiceAct,
  TransferAct,
} from './scenarios';

export const noteOf = (s: Scenario) => `ZZE2E Matrix ${s.id}`;

export const day = (offset: DateSpec) => {
  const at = new Date();

  at.setDate(at.getDate() + offset);

  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};

export const isService = (act: Act): act is ServiceAct => 'service' in act;
export const isAssign = (act: Act): act is AssignAct => 'assign' in act;
export const isTransfer = (act: Act): act is TransferAct => 'transfer' in act;

const changesOf = (s: Scenario): Change[] => [
  ...(typeof s.send === 'object' ? (s.send.changes ?? []) : []),
  ...(s.modifications ?? []).flatMap((modification) => modification.changes),
];

const peopleStepsOf = (s: Scenario): PeopleStep[] => [
  ...s.people,
  ...changesOf(s).flatMap((change) => ('addPeople' in change ? [change.addPeople] : [])),
];

export const futureOf = (s: Scenario, key: string): FutureSpec => {
  const replaced = changesOf(s)
    .flatMap((change) => ('replaceFuture' in change && change.replaceFuture === key ? [change.with] : []))
    .pop();
  const first = peopleStepsOf(s).flatMap((step) => ('future' in step && step.future.key === key ? [step.future] : []))[0];
  const found = replaced ?? first;

  if (!found) throw new Error(`${s.id}: no future person ${key}`);

  return found;
};

export const futureName = (s: Scenario, spec: FutureSpec) => `ZZE2E Matrix ${s.id} ${spec.label}`;

export const personName = (s: Scenario, ref: Ref): string => {
  if ('future' in ref) return futureName(s, futureOf(s, ref.future));

  if ('team' in ref) {
    const team = Object.keys(matrix.teams).sort()[ref.team];
    const name = matrix.teams[team]?.[ref.at];

    if (!name) throw new Error(`${s.id}: no member ${ref.at} in team ${ref.team}`);

    return name;
  }

  const name = matrix.people[ref.kind]?.[ref.at];

  if (!name) throw new Error(`${s.id}: the pool has no ${ref.kind} ${ref.at}`);

  return name;
};

export const teamName = (index: number) => Object.keys(matrix.teams).sort()[index];

export const departmentName = (department: 'alpha' | 'beta' | number) =>
  typeof department === 'number' ? teamName(department) : matrix.departments[department];

const describedOf = (s: Scenario, key: string): NewMachineSpec | null => {
  const acts = [
    ...s.acts,
    ...changesOf(s).flatMap((change) =>
      'addAct' in change ? [change.addAct] : 'replaceFuture' in change ? change.acts : []
    ),
    ...(s.refusals ?? []).flatMap((refusal) =>
      refusal.refusal === 'machine-two-ways' ? [refusal.first] : []
    ),
  ];

  for (const act of acts) {
    if (isAssign(act) && typeof act.machine === 'object' && 'describe' in act.machine && act.machine.describe.key === key) {
      return act.machine.describe;
    }

    if (isService(act)) {
      for (const slot of act.machines ?? []) if (slot.describe?.key === key) return slot.describe;
    }
  }

  return null;
};

export const hostnameOf = (s: Scenario, key: string) => {
  const same = describedOf(s, key)?.sameAs;

  return same ? matrix.stock[same.stock] : `ZZE2E-MATRIX-${s.id}-${key}`;
};
export const serialOf = (s: Scenario, key: string) => `ZZE2E-SN-MATRIX-${s.id}-${key}`;

export const requestedLabel = (s: Scenario, key: string) => {
  const spec = describedOf(s, key);

  if (!spec) throw new Error(`${s.id}: no requested machine ${key}`);
  if (spec.hostname) return hostnameOf(s, key);

  return spec.type ? `New ${spec.type.toLowerCase()}` : 'New device';
};

export const machineName = (s: Scenario, ref: MachineRef): string => {
  if ('stock' in ref) {
    const name = matrix.stock[ref.stock];

    if (!name) throw new Error(`${s.id}: no stock machine ${ref.stock}`);

    return name;
  }

  if ('heldBy' in ref) {
    const name = matrix.held[personName(s, ref.heldBy)];

    if (!name) throw new Error(`${s.id}: ${personName(s, ref.heldBy)} holds no machine`);

    return name;
  }

  return hostnameOf(s, ref.requested);
};

export const actLabel = (act: Act) => {
  if (isService(act)) return `${act.op} ${matrix.services[act.service]}`;
  if (isAssign(act)) return 'Assign device';
  if (isTransfer(act)) return 'Change holder';

  return 'Return to stock';
};

export const targetName = (s: Scenario, target: Ref | MachineRef) =>
  'stock' in target || 'heldBy' in target || 'requested' in target
    ? 'requested' in target
      ? requestedLabel(s, target.requested)
      : machineName(s, target)
    : personName(s, target);

export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const poolOf = (s: Scenario): string[] => {
  const refs: Ref[] = [];
  const machines: MachineRef[] = [];
  const walkAct = (act: Act) => {
    if (isService(act)) {
      if (typeof act.scope === 'object' && 'person' in act.scope) refs.push(act.scope.person);
      refs.push(...(act.only ?? []));
      machines.push(...(act.onMachines ?? []).filter((ref) => !('requested' in ref)));
    } else if (isAssign(act)) {
      refs.push(act.assign);
      if (typeof act.machine === 'object' && 'stock' in act.machine) machines.push(act.machine);
      if (typeof act.machine === 'object' && 'heldBy' in act.machine) machines.push(act.machine);
    } else if (isTransfer(act)) {
      machines.push(act.transfer);
      refs.push(act.to);
    } else {
      machines.push(...act.giveBack);
    }
  };
  const walkStep = (step: PeopleStep) => {
    if ('existing' in step) refs.push(...step.existing);
    if ('devices' in step) machines.push(...step.devices.filter((ref) => !('requested' in ref)));
    if ('department' in step) refs.push({ team: step.department, at: -1 });
  };

  peopleStepsOf(s).forEach(walkStep);
  s.acts.forEach(walkAct);
  changesOf(s).forEach((change) => {
    if ('addAct' in change) walkAct(change.addAct);
    if ('removePerson' in change) refs.push(change.removePerson);
  });
  (s.refusals ?? []).forEach((refusal) => {
    if ('people' in refusal) refs.push(...refusal.people);
    if (refusal.refusal === 'same-machine-twice') walkAct(refusal.first);
  });

  const people = refs.map((ref) =>
    'future' in ref ? '' : 'team' in ref ? `team:${ref.team}` : `${ref.kind}:${ref.at}`
  );
  const held = machines.map((ref) =>
    'stock' in ref ? `stock:${ref.stock}` : 'heldBy' in ref && !('future' in ref.heldBy) ? `holder-of:${JSON.stringify(ref.heldBy)}` : ''
  );

  return [...new Set([...people, ...held].filter(Boolean))];
};
