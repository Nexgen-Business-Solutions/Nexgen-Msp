import type { Scenario } from '../scenarios';

const AV = 'MX-AV';
const MAIL = 'MX-MAIL';

export const DEVICES: Scenario[] = [
  {
    id: 'S105',
    title:
      'manager · a machine nobody holds, chosen for itself · a Device service added on it · not modified · accepted · executed on the pre-filled date',
    asker: 'manager',
    people: [{ devices: [{ stock: 16 }] }],
    acts: [{ service: AV, op: 'Add', scope: 'all' }],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      machines: [
        {
          machine: { stock: 16 },
          holder: null,
          services: [{ service: AV, status: 'Active', start: 0 }],
        },
      ],
    },
  },
  {
    id: 'S106',
    title:
      'manager · a machine somebody holds, chosen by the machine · its holder is the subject · their own service is added too',
    asker: 'manager',
    people: [{ devices: [{ heldBy: { kind: 'device_active', at: 17 } }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      people: [
        {
          who: { kind: 'device_active', at: 17 },
          services: [
            { service: AV, status: 'Active', start: -120 },
            { service: MAIL, status: 'Active', start: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'S107',
    title:
      'manager · a machine nobody holds · a holder named among the people on file · modified once · executed, and the machine ends up with them',
    asker: 'manager',
    people: [{ devices: [{ stock: 17 }] }, { existing: [{ kind: 'bare', at: 9 }] }],
    acts: [{ transfer: { stock: 17 }, to: { kind: 'bare', at: 9 }, scope: 'all' }],
    send: 'now',
    modifications: [{ changes: [{ date: 0 }], lines: 1 }],
    decisions: [{ accept: 'groups' }],
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      machines: [{ machine: { stock: 17 }, holder: { kind: 'bare', at: 9 } }],
      people: [{ who: { kind: 'bare', at: 9 }, services: [], machines: [{ stock: 17 }] }],
    },
  },
];
