import type { RequestTarget } from '@/lib/api/portal';

const HANDED_OVER = ['device.assign', 'device.transfer'];

type Act = { operationCode: string; targets: RequestTarget[] };
type Person = { key: string; clientUser?: string | null; fullName?: string | null };

export const machineOf = (target: RequestTarget) =>
  target.managed_device || target.device_requirement_key || null;

export const machinesTaken = (acts: Act[], people: Person[]) => {
  const names = new Map<string, string>();

  people.forEach((person) => {
    names.set(person.key, person.fullName ?? '');
    if (person.clientUser) names.set(person.clientUser, person.fullName ?? '');
  });

  const taken = new Map<string, string>();

  for (const act of acts) {
    if (!HANDED_OVER.includes(act.operationCode)) continue;

    for (const target of act.targets) {
      const machine = machineOf(target);

      if (!machine) continue;

      taken.set(
        machine,
        act.operationCode === 'device.assign'
          ? target.full_name
          : names.get(target.requested_holder_subject_key ?? '') ||
              names.get(target.requested_holder ?? '') ||
              ''
      );
    }
  }

  return taken;
};

export const takenReason = (receiver: string) =>
  receiver
    ? `Already asked for ${receiver} in this request.`
    : 'Already handed over in this request.';
