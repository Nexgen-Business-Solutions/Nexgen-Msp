import { writeFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { run } from './bench';
import { statePath } from './state';
import { totp } from './totp';

const BASE = process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000';

/**
 * The company the run reads is built before the first browser opens, and each account
 * signs in once.
 *
 * Once, deliberately: the application caps how often a password may be offered, and a
 * suite that signed in per test would be refused by its own product — correctly.
 */
export default async function globalSetup() {
  const printed = run('nexgen_msp.utils.e2e_fixture.setup');
  const start = printed.indexOf('{');
  const fixture = JSON.parse(printed.slice(start, printed.lastIndexOf('}') + 1));

  // one request already raised, so the fulfilment screens have something real to read
  const raised = run('nexgen_msp.utils.e2e_fixture.submitted_request');

  fixture.request = JSON.parse(
    raised.slice(raised.indexOf('{'), raised.lastIndexOf('}') + 1)
  ).request;

  // a second request whose work waits on two usernames nobody has entered yet
  const owed = run('nexgen_msp.utils.e2e_fixture.add_request');

  fixture.add_request = JSON.parse(
    owed.slice(owed.indexOf('{'), owed.lastIndexOf('}') + 1)
  ).request;

  // a third request: a person to create, a machine to settle, a username to record
  const fresh = run('nexgen_msp.utils.e2e_fixture.new_person_request');

  fixture.new_person_request = JSON.parse(
    fresh.slice(fresh.indexOf('{'), fresh.lastIndexOf('}') + 1)
  ).request;

  writeFileSync(statePath('standard', 'fixture.json'), JSON.stringify(fixture, null, 2));

  for (const [who, email, secret] of [
    ['technician', fixture.technician, fixture.technician_secret],
    ['manager', fixture.manager, fixture.manager_secret],
    ['administrator', fixture.administrator, fixture.administrator_secret],
    ['operator', fixture.operator, fixture.operator_secret],
    ['requester', fixture.requester, fixture.requester_secret],
  ]) {
    const context = await request.newContext({ baseURL: BASE });

    const first = await context.post('/api/method/nexgen_msp.api.auth.endpoints.v1.pre_login', {
      form: { username: email, password: fixture.password },
    });

    if (!first.ok()) throw new Error(`password refused for ${email}: ${await first.text()}`);

    const pending = (await first.json()).message;

    const second = await context.post(
      '/api/method/nexgen_msp.api.auth.endpoints.v1.complete_login',
      { form: { pending_token: pending.pending_token, otp: totp(secret), username: email } }
    );

    if (!second.ok()) throw new Error(`code refused for ${email}: ${await second.text()}`);

    await context.storageState({ path: statePath('standard', 'auth', `${who}.json`) });
    await context.dispose();
  }
}
