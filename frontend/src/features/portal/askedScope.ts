import type { RequestTarget } from '@/lib/api/portal';

/**
 * What an act already covers in a request, and how much of that is in front of you.
 *
 * Two separate questions, and they were answered with one number. The count of everything the
 * request already asks for says nothing about the scope on screen: it reported "2 asked" while
 * looking at a person who was neither of the two. A badge is only worth reading if it is about
 * what you can see.
 */

export type AskedGroup = {
  operationCode: string;
  serviceItem?: string | null;
  targets: RequestTarget[];
};

export const keyOf = (target: RequestTarget) =>
  `${target.subject_key}|${target.managed_device ?? target.device_requirement_key ?? ''}|${
    target.source_service_assignment ?? ''
  }`;

export const askedKeyOf = (operationCode: string, target: RequestTarget) =>
  operationCode === 'device.assign' ? target.subject_key : keyOf(target);

export const askedIndex = (groups: AskedGroup[]) => {
  const found = new Map<string, Set<string>>();

  for (const group of groups) {
    const key = `${group.operationCode}|${group.serviceItem ?? ''}`;
    const covered = found.get(key) ?? new Set<string>();

    group.targets.forEach((target) => covered.add(askedKeyOf(group.operationCode, target)));
    found.set(key, covered);
  }

  return found;
};

export const askedFrom = (
  index: Map<string, Set<string>>,
  operationCode: string,
  serviceItem?: string | null
) => index.get(`${operationCode}|${serviceItem ?? ''}`) ?? new Set<string>();

export const askedAmong = (
  index: Map<string, Set<string>>,
  targets: RequestTarget[],
  operationCode: string,
  serviceItem?: string | null
) => {
  const asked = askedFrom(index, operationCode, serviceItem);

  return targets.filter((target) => asked.has(askedKeyOf(operationCode, target))).length;
};

export const machinesAskedFor = (groups: AskedGroup[]) => {
  const found = new Map<string, string[]>();

  for (const group of groups) {
    if (group.operationCode !== 'device.assign') continue;

    for (const target of group.targets) {
      const labels = found.get(target.subject_key) ?? [];

      labels.push(target.device_label || 'A Device of your choice');
      found.set(target.subject_key, labels);
    }
  }

  return found;
};
