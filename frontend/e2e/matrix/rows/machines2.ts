import type { Scenario } from '../scenarios';

const AV = 'MX-AV';

export const MACHINES2: Scenario[] = [
  {
    id: 'S95',
    title:
      'manager · one existing person asked two new described machines (two machines for one person) · not modified · group accepted · both registered · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 31 }] }],
    acts: [
      { assign: { kind: 'bare', at: 31 }, machine: { describe: { key: 'LA', type: 'Laptop', hostname: true, serial: true } } },
      { assign: { kind: 'bare', at: 31 }, machine: { describe: { key: 'LB', type: 'Desktop', hostname: true, serial: true } } },
    ],
    send: 'now',
    sentLines: 2,
    decisions: [{ accept: 'groups' }],
    prepare: [
      { machine: 'LA', how: 'register', opensOn: 'Register new Device' },
      { machine: 'LB', how: 'register', opensOn: 'Register new Device' },
    ],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 31 }, services: [], machines: [{ requested: 'LA' }, { requested: 'LB' }] },
      ],
      machines: [
        { machine: { requested: 'LA' }, holder: { kind: 'bare', at: 31 }, services: [] },
        { machine: { requested: 'LB' }, holder: { kind: 'bare', at: 31 }, services: [] },
      ],
    },
  },
  {
    id: 'S96',
    title:
      'manager · a future person asked two machines from stock (two machines for one person) · saved as draft, reopened, sent · created, both waiting for them · Execute N ready',
    asker: 'manager',
    people: [{ future: { key: 'tw', label: 'Twofold', department: 'alpha' } }],
    acts: [
      { assign: { future: 'tw' }, machine: { stock: 1 } },
      { assign: { future: 'tw' }, machine: { stock: 2 } },
    ],
    send: { draft: true },
    sentLines: 2,
    decisions: [{ accept: 'lines' }],
    prepare: [{ person: 'tw', how: 'create', opensOn: 'Create new' }],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { future: 'tw' }, services: [], machines: [{ stock: 1 }, { stock: 2 }], department: 'alpha' },
      ],
      machines: [
        { machine: { stock: 1 }, holder: { future: 'tw' }, services: [] },
        { machine: { stock: 2 }, holder: { future: 'tw' }, services: [] },
      ],
    },
  },
  {
    id: 'S97',
    title:
      'manager · one person asked a machine from stock, a new described one and one somebody holds, a Device service on the last two · the stock machine removed before work starts · registered · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 33 }] }],
    acts: [
      { assign: { kind: 'bare', at: 33 }, machine: { stock: 4 } },
      { assign: { kind: 'bare', at: 33 }, machine: { describe: { key: 'NB', type: 'Laptop', hostname: true, serial: true } } },
      { assign: { kind: 'bare', at: 33 }, machine: { heldBy: { kind: 'holder', at: 13 } } },
      {
        service: AV,
        op: 'Add',
        scope: { person: { kind: 'bare', at: 33 } },
        onMachines: [{ requested: 'NB' }, { heldBy: { kind: 'holder', at: 13 } }],
      },
    ],
    send: 'now',
    sentLines: 5,
    modifications: [
      {
        changes: [{ removeAct: { assign: { kind: 'bare', at: 33 }, machine: { stock: 4 } } }],
        lines: 4,
      },
    ],
    decisions: [{ accept: 'groups' }],
    prepare: [{ machine: 'NB', how: 'register', opensOn: 'Register new Device' }],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        {
          who: { kind: 'bare', at: 33 },
          services: [],
          machines: [{ requested: 'NB' }, { heldBy: { kind: 'holder', at: 13 } }],
        },
        {
          who: { kind: 'holder', at: 13 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'holder', at: 13 } }, until: 0 }],
        },
      ],
      machines: [
        {
          machine: { requested: 'NB' },
          holder: { kind: 'bare', at: 33 },
          services: [{ service: AV, status: 'Active', start: 0 }],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 13 } },
          holder: { kind: 'bare', at: 33 },
          services: [{ service: AV, status: 'Active', start: 0 }],
          formerly: [{ holder: { kind: 'holder', at: 13 }, until: 0 }],
        },
        { machine: { stock: 4 }, holder: null, services: [] },
      ],
    },
  },
  {
    id: 'S98',
    title:
      'manager · the same machine from stock asked twice, for the same person and for another · the picker refuses it both times · nothing sent',
    asker: 'manager',
    people: [],
    acts: [],
    send: 'now',
    refusals: [
      {
        refusal: 'same-machine-twice',
        people: [
          { kind: 'bare', at: 24 },
          { kind: 'bare', at: 25 },
        ],
        first: { assign: { kind: 'bare', at: 24 }, machine: { stock: 9 } },
        again: [
          { kind: 'bare', at: 24 },
          { kind: 'bare', at: 25 },
        ],
      },
    ],
  },
  {
    id: 'S99',
    title:
      'requester · one existing person, a new described machine with a Device service · draft reopened, a second new machine added, sent · approved · both registered · Execute N ready',
    asker: 'requester',
    people: [{ existing: [{ kind: 'bare', at: 26 }] }],
    acts: [
      { assign: { kind: 'bare', at: 26 }, machine: { describe: { key: 'D1', type: 'Laptop', hostname: true, serial: true } } },
      { service: AV, op: 'Add', scope: 'all', onMachines: [{ requested: 'D1' }] },
    ],
    send: {
      draft: true,
      changes: [
        {
          addAct: {
            assign: { kind: 'bare', at: 26 },
            machine: { describe: { key: 'D2', type: 'Desktop', hostname: true, serial: true } },
          },
        },
      ],
    },
    sentLines: 3,
    approval: 'approve',
    decisions: [{ accept: 'lines' }],
    prepare: [
      { machine: 'D1', how: 'register', opensOn: 'Register new Device' },
      { machine: 'D2', how: 'register', opensOn: 'Register new Device' },
    ],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 26 }, services: [], machines: [{ requested: 'D1' }, { requested: 'D2' }] },
      ],
      machines: [
        {
          machine: { requested: 'D1' },
          holder: { kind: 'bare', at: 26 },
          services: [{ service: AV, status: 'Active', start: 0 }],
        },
        { machine: { requested: 'D2' }, holder: { kind: 'bare', at: 26 }, services: [] },
      ],
    },
  },
];
