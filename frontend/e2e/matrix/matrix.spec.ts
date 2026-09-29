import { compose, facts, refuse } from './compose';
import { customerReads, recordsHold, screensShow } from './expect';
import {
  beginWork,
  closeRequest,
  companyDecides,
  decide,
  execute,
  lockedForCustomer,
  neverAtNexgen,
  prepare,
  usernames,
} from './fulfil';
import { modify, notOffered } from './modify';
import { poolOf } from './refs';
import { SCENARIOS, type Scenario } from './scenarios';
import { expect, test, type Window } from './window';

const walk = async (window: Window, s: Scenario) => {
  if (s.refusals) {
    const before = facts(s).total;

    for (const refusal of s.refusals) await refuse(window, s, refusal);

    const after = facts(s);

    expect(after.total, 'nothing was sent').toBe(before);
    expect(after.count).toBe(0);

    return;
  }

  const name = await compose(window, s);

  if (s.notOfferedTo) await notOffered(window, s, name, s.notOfferedTo);

  const modifications = (s.modifications ?? []).map((modification, index) => ({ modification, index }));

  for (const { modification, index } of modifications.filter((entry) => !entry.modification.afterApproval)) {
    await modify(window, s, name, modification, index);
  }

  if (s.approval) {
    await companyDecides(window, s, name);

    if (typeof s.approval === 'object') {
      await neverAtNexgen(window, name);
      await customerReads(window, s, name);
      recordsHold(s);

      return;
    }
  }

  for (const { modification, index } of modifications.filter((entry) => entry.modification.afterApproval)) {
    await modify(window, s, name, modification, index);
  }

  if (s.decisions) {
    await beginWork(window, s, name);

    if (s.lockedAfterStart) await lockedForCustomer(window, s, name);

    if (await decide(window, s)) {
      await prepare(window, s);
      await usernames(window, s);
      await execute(window, s, name);

      if (s.complete) await closeRequest(window, s, name);
    }
  }

  recordsHold(s);
  await screensShow(window, s);
  await customerReads(window, s, name);
};

test('no two scenarios share an entry of the pool', () => {
  const owners = new Map<string, string>();

  for (const s of SCENARIOS) {
    for (const entry of poolOf(s)) {
      expect(owners.get(entry), `${entry} is used by ${owners.get(entry)} and ${s.id}`).toBeUndefined();
      owners.set(entry, s.id);
    }
  }
});

for (const s of SCENARIOS) {
  test(`${s.id} · ${s.title}`, async ({ window }) => {
    await walk(window, s);
  });
}
