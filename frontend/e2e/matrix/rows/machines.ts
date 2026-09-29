import type { Scenario } from '../scenarios';

const AV = 'MX-AV';
const BACKUP = 'MX-BACKUP';

export const MACHINES: Scenario[] = [
  {
    id: 'S35',
    title:
      'manager · one existing person · a machine from stock · not modified · accepted line by line · row by row on the pre-filled date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 30 }] }],
    acts: [{ assign: { kind: 'bare', at: 30 }, machine: { stock: 0 } }],
    send: 'now',
    decisions: [{ accept: 'lines' }],
    execute: [
      {
        row: {
          act: { assign: { kind: 'bare', at: 30 }, machine: { stock: 0 } },
          target: { stock: 0 },
        },
      },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'bare', at: 30 },
          services: [],
          machines: [{ stock: 0 }],
        },
      ],
      machines: [
        {
          machine: { stock: 0 },
          holder: { kind: 'bare', at: 30 },
          services: [],
        },
      ],
    },
  },
  {
    id: 'S36',
    title:
      'manager · a Device service added on a machine already held · the act swapped for another · group accepted · Execute N ready on a changed date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'holder', at: 1 }] }],
    acts: [{ service: BACKUP, op: 'Add', scope: 'all' }],
    send: 'now',
    modifications: [
      {
        changes: [
          { removeAct: { service: BACKUP, op: 'Add', scope: 'all' } },
          { addAct: { service: AV, op: 'Add', scope: 'all' } },
        ],
      },
    ],
    decisions: [{ accept: 'groups' }],
    execute: [{ ready: true, date: 2 }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'holder', at: 1 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 1 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 1 } },
          holder: { kind: 'holder', at: 1 },
          services: [{ service: AV, status: 'Active', start: 2 }],
        },
      ],
    },
  },
  {
    id: 'S37',
    title:
      'manager · suspend, resume and end a Device service · a person and an act added, date changed · the end refused, the rest Execute N ready',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 1 },
          { kind: 'device_suspended', at: 0 },
          { kind: 'device_active', at: 2 },
        ],
      },
    ],
    acts: [
      {
        service: AV,
        op: 'Suspend',
        scope: { person: { kind: 'device_active', at: 1 } },
      },
      {
        service: AV,
        op: 'Resume',
        scope: { person: { kind: 'device_suspended', at: 0 } },
      },
      {
        service: AV,
        op: 'End',
        scope: { person: { kind: 'device_active', at: 2 } },
      },
    ],
    send: 'now',
    sentLines: 3,
    modifications: [
      {
        changes: [
          { addPeople: { existing: [{ kind: 'device_active', at: 3 }] } },
          {
            addAct: {
              service: AV,
              op: 'Suspend',
              scope: { person: { kind: 'device_active', at: 3 } },
            },
          },
          { date: 3 },
        ],
      },
    ],
    decisions: [
      {
        refuseLine: { kind: 'device_active', at: 2 },
        reason: 'ZZE2E matrix S37: keep this one protected',
      },
      { accept: 'lines' },
    ],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 3,
      rejected: 1,
      people: [
        {
          who: { kind: 'device_active', at: 1 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 1 } }],
        },
        {
          who: { kind: 'device_suspended', at: 0 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 0 } }],
        },
        {
          who: { kind: 'device_active', at: 2 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 2 } }],
        },
        {
          who: { kind: 'device_active', at: 3 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 3 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 1 } },
          holder: { kind: 'device_active', at: 1 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 0 } },
          holder: { kind: 'device_suspended', at: 0 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 2 } },
          holder: { kind: 'device_active', at: 2 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 3 } },
          holder: { kind: 'device_active', at: 3 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
      ],
    },
  },
  {
    id: 'S38',
    title:
      'manager · change holder to an existing person · not modified · handed over at execution to somebody else, with a reason',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'holder', at: 2 },
          { kind: 'bare', at: 32 },
        ],
      },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'holder', at: 2 } },
        to: { kind: 'bare', at: 32 },
        scope: { person: { kind: 'holder', at: 2 } },
      },
    ],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    execute: [
      {
        row: {
          act: {
            transfer: { heldBy: { kind: 'holder', at: 2 } },
            to: { kind: 'bare', at: 32 },
            scope: 'all',
          },
          target: { heldBy: { kind: 'holder', at: 2 } },
        },
        date: 1,
        handTo: {
          to: { kind: 'bare', at: 33 },
          reason: 'ZZE2E matrix S38: the desk moved to the other one',
        },
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        { who: { kind: 'holder', at: 2 }, services: [], machines: [] },
        { who: { kind: 'bare', at: 32 }, services: [], machines: [] },
        {
          who: { kind: 'bare', at: 33 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 2 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 2 } },
          holder: { kind: 'bare', at: 33 },
          services: [],
          formerly: [{ holder: { kind: 'holder', at: 2 }, until: 1 }],
        },
      ],
    },
  },
  {
    id: 'S39',
    title: 'manager · a machine returned to stock · an act removed before the work · from the person view on today',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 4 },
          { kind: 'device_active', at: 5 },
        ],
      },
    ],
    acts: [
      {
        giveBack: [{ heldBy: { kind: 'device_active', at: 4 } }],
        scope: { person: { kind: 'device_active', at: 4 } },
      },
      {
        service: AV,
        op: 'Suspend',
        scope: { person: { kind: 'device_active', at: 5 } },
      },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          {
            removeAct: {
              service: AV,
              op: 'Suspend',
              scope: { person: { kind: 'device_active', at: 5 } },
            },
          },
        ],
      },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [{ person: { kind: 'device_active', at: 4 }, date: 0 }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 4 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 4 } }, until: 0 }],
        },
        {
          who: { kind: 'device_active', at: 5 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 5 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 4 } },
          holder: null,
          services: [{ service: AV, status: 'Active', start: -120 }],
          formerly: [{ holder: { kind: 'device_active', at: 4 }, until: 0 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 5 } },
          holder: { kind: 'device_active', at: 5 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
      ],
    },
  },
  {
    id: 'S40',
    title:
      'manager · a new machine described (type, hostname, serial) · saved as draft, reopened, sent · registered new · row by row on a changed date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 10 }] }],
    acts: [
      {
        assign: { kind: 'named', at: 10 },
        machine: {
          describe: { key: 'WS', type: 'Laptop', hostname: true, serial: true },
        },
      },
    ],
    send: { draft: true },
    decisions: [{ accept: 'groups' }],
    prepare: [{ machine: 'WS', how: 'register', opensOn: 'Register new Device' }],
    execute: [
      {
        row: {
          act: { assign: { kind: 'named', at: 10 }, machine: 'unspecified' },
          target: { requested: 'WS' },
        },
        date: 1,
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'named', at: 10 },
          services: [],
          machines: [{ requested: 'WS' }],
        },
      ],
      machines: [
        {
          machine: { requested: 'WS' },
          holder: { kind: 'named', at: 10 },
          services: [],
        },
      ],
    },
  },
  {
    id: 'S41',
    title:
      'manager · a future person gets a held machine and a new described one (two machines for one person) · date changed, then the requested machine changed · created, registered once the person exists · Execute N ready',
    asker: 'manager',
    people: [
      { existing: [{ kind: 'holder', at: 3 }] },
      {
        future: {
          key: 'fx',
          label: 'Fixer',
          department: 'beta',
          email: 'zze2e.mx.s41@example.invalid',
        },
      },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'holder', at: 3 } },
        to: { future: 'fx' },
        scope: { person: { kind: 'holder', at: 3 } },
      },
      {
        assign: { future: 'fx' },
        machine: {
          describe: { key: 'NB', type: 'Laptop', hostname: true, serial: true },
        },
      },
    ],
    send: 'now',
    modifications: [
      { changes: [{ date: 2 }] },
      {
        changes: [
          { removeAct: { assign: { future: 'fx' }, machine: 'unspecified' } },
          {
            addAct: {
              assign: { future: 'fx' },
              machine: {
                describe: { key: 'NB2', hostname: true, serial: true },
              },
            },
          },
        ],
      },
    ],
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'fx', how: 'create', opensOn: 'Create new' },
      { machine: 'NB2', how: 'register', opensOn: 'Register new Device', waitsFor: 'fx' },
    ],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { kind: 'holder', at: 3 }, services: [], machines: [] },
        {
          who: { future: 'fx' },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 3 } }, { requested: 'NB2' }],
          department: 'beta',
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 3 } },
          holder: { future: 'fx' },
          services: [],
          formerly: [{ holder: { kind: 'holder', at: 3 }, until: 2 }],
        },
        {
          machine: { requested: 'NB2' },
          holder: { future: 'fx' },
          services: [],
        },
      ],
    },
  },
  {
    id: 'S42',
    title:
      'manager · a new machine asked with nothing said, a Device service on it · not modified · resolved to a machine from stock · row by row',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 34 }] }],
    acts: [
      {
        assign: { kind: 'bare', at: 34 },
        machine: { describe: { key: 'PC' } },
      },
      {
        service: AV,
        op: 'Add',
        scope: 'all',
        machines: [{ for: { kind: 'bare', at: 34 }, use: 'PC' }],
      },
    ],
    send: 'now',
    decisions: [{ accept: 'lines' }],
    prepare: [{ machine: 'PC', how: { stock: 3 }, opensOn: 'Register new Device' }],
    execute: [
      {
        row: {
          act: { assign: { kind: 'bare', at: 34 }, machine: 'unspecified' },
          target: { stock: 3 },
        },
      },
      {
        row: {
          act: { service: AV, op: 'Add', scope: 'all' },
          target: { stock: 3 },
        },
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { kind: 'bare', at: 34 },
          services: [],
          machines: [{ stock: 3 }],
        },
      ],
      machines: [
        {
          machine: { stock: 3 },
          holder: { kind: 'bare', at: 34 },
          services: [{ service: AV, status: 'Active', start: 0 }],
        },
      ],
    },
  },
  {
    id: 'S43',
    title:
      'manager · a future person named only, a new machine with its Device service · a person and an act added, then the date · the machine is one somebody holds (hand-over) · Execute N ready',
    asker: 'manager',
    people: [{ future: { key: 'tp', label: 'Temp', department: 'alpha' } }],
    acts: [
      {
        assign: { future: 'tp' },
        machine: { describe: { key: 'HD', hostname: true } },
      },
      {
        service: BACKUP,
        op: 'Add',
        scope: { person: { future: 'tp' } },
        machines: [{ for: { future: 'tp' }, use: 'HD' }],
      },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          { addPeople: { existing: [{ kind: 'device_active', at: 6 }] } },
          {
            addAct: {
              service: AV,
              op: 'Suspend',
              scope: { person: { kind: 'device_active', at: 6 } },
            },
          },
        ],
        lines: 3,
      },
      { changes: [{ date: 1 }] },
    ],
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'tp', how: 'create' },
      { machine: 'HD', how: { heldBy: { kind: 'holder', at: 4 } } },
    ],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'holder', at: 4 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'holder', at: 4 } }, until: 1 }],
        },
        {
          who: { future: 'tp' },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 4 } }],
          department: 'alpha',
        },
        {
          who: { kind: 'device_active', at: 6 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 6 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 4 } },
          holder: { future: 'tp' },
          services: [{ service: BACKUP, status: 'Active', start: 1 }],
          formerly: [{ holder: { kind: 'holder', at: 4 }, until: 1 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 6 } },
          holder: { kind: 'device_active', at: 6 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
      ],
    },
  },
  {
    id: 'S44',
    title:
      'manager · a machine from stock · swapped for another before the work · Nexgen refuses the whole request · both machines stay in stock',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 36 }] }],
    acts: [{ assign: { kind: 'bare', at: 36 }, machine: { stock: 5 } }],
    send: 'now',
    modifications: [
      {
        changes: [
          {
            removeAct: {
              assign: { kind: 'bare', at: 36 },
              machine: { stock: 5 },
            },
          },
          {
            addAct: { assign: { kind: 'bare', at: 36 }, machine: { stock: 6 } },
          },
        ],
      },
    ],
    decisions: [
      { refuseLine: { kind: 'bare', at: 36 }, reason: 'ZZE2E matrix S44: no machine left for this budget' },
      { refuseRequest: 'ZZE2E matrix S44: nothing left to do in this request' },
    ],
    customerReads: true,
    outcome: {
      status: 'Rejected',
      lines: 1,
      accepted: 0,
      rejected: 1,
      people: [{ who: { kind: 'bare', at: 36 }, services: [], machines: [] }],
      machines: [
        { machine: { stock: 5 }, holder: null, services: [] },
        { machine: { stock: 6 }, holder: null, services: [] },
      ],
    },
  },
  {
    id: 'S45',
    title:
      'manager · three changes of holder to existing people · date changed · one hand-over refused and left where it was · the others row by row on different dates',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'holder', at: 5 },
          { kind: 'holder', at: 6 },
          { kind: 'holder', at: 7 },
          { kind: 'bare', at: 37 },
          { kind: 'bare', at: 38 },
          { kind: 'bare', at: 39 },
        ],
      },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'holder', at: 5 } },
        to: { kind: 'bare', at: 37 },
        scope: { person: { kind: 'holder', at: 5 } },
      },
      {
        transfer: { heldBy: { kind: 'holder', at: 6 } },
        to: { kind: 'bare', at: 38 },
        scope: { person: { kind: 'holder', at: 6 } },
      },
      {
        transfer: { heldBy: { kind: 'holder', at: 7 } },
        to: { kind: 'bare', at: 39 },
        scope: { person: { kind: 'holder', at: 7 } },
      },
    ],
    send: 'now',
    modifications: [{ changes: [{ date: 4 }] }],
    decisions: [
      {
        refuseLine: { kind: 'holder', at: 6 },
        reason: 'ZZE2E matrix S45: this one stays at the desk',
      },
      { accept: 'lines' },
    ],
    execute: [
      {
        row: {
          act: {
            transfer: { heldBy: { kind: 'holder', at: 5 } },
            to: { kind: 'bare', at: 37 },
            scope: 'all',
          },
          target: { heldBy: { kind: 'holder', at: 5 } },
        },
        date: 3,
      },
      {
        row: {
          act: {
            transfer: { heldBy: { kind: 'holder', at: 7 } },
            to: { kind: 'bare', at: 39 },
            scope: 'all',
          },
          target: { heldBy: { kind: 'holder', at: 7 } },
        },
        date: 1,
      },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 2,
      rejected: 1,
      people: [
        { who: { kind: 'holder', at: 5 }, services: [], machines: [] },
        {
          who: { kind: 'holder', at: 6 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 6 } }],
        },
        { who: { kind: 'holder', at: 7 }, services: [], machines: [] },
        {
          who: { kind: 'bare', at: 37 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 5 } }],
        },
        { who: { kind: 'bare', at: 38 }, services: [], machines: [] },
        {
          who: { kind: 'bare', at: 39 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 7 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 5 } },
          holder: { kind: 'bare', at: 37 },
          services: [],
          formerly: [{ holder: { kind: 'holder', at: 5 }, until: 3 }],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 6 } },
          holder: { kind: 'holder', at: 6 },
          services: [],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 7 } },
          holder: { kind: 'bare', at: 39 },
          services: [],
          formerly: [{ holder: { kind: 'holder', at: 7 }, until: 1 }],
        },
      ],
    },
  },
  {
    id: 'S46',
    title:
      'manager · a new machine described · draft reopened, a person and a Device service added, date changed, sent · registered new · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 11 }] }],
    acts: [
      {
        assign: { kind: 'named', at: 11 },
        machine: {
          describe: { key: 'T1', type: 'Laptop', hostname: true, serial: true },
        },
      },
    ],
    send: {
      draft: true,
      changes: [
        { addPeople: { existing: [{ kind: 'holder', at: 8 }] } },
        {
          addAct: {
            service: BACKUP,
            op: 'Add',
            scope: { person: { kind: 'holder', at: 8 } },
          },
        },
        { date: 1 },
      ],
    },
    decisions: [{ accept: 'lines' }],
    prepare: [{ machine: 'T1', how: 'register', opensOn: 'Register new Device' }],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { kind: 'named', at: 11 },
          services: [],
          machines: [{ requested: 'T1' }],
        },
        {
          who: { kind: 'holder', at: 8 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 8 } }],
        },
      ],
      machines: [
        {
          machine: { requested: 'T1' },
          holder: { kind: 'named', at: 11 },
          services: [],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 8 } },
          holder: { kind: 'holder', at: 8 },
          services: [{ service: BACKUP, status: 'Active', start: 1 }],
        },
      ],
    },
  },
  {
    id: 'S47',
    title:
      'manager · a new machine named by the hostname of one in stock · a Device service on it added before the work · pre-selected by exact hostname · row by row on different dates',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 12 }] }],
    acts: [
      {
        assign: { kind: 'named', at: 12 },
        machine: {
          describe: { key: 'SM', hostname: true, sameAs: { stock: 7 } },
        },
      },
    ],
    send: 'now',
    sentLines: 1,
    modifications: [
      {
        changes: [
          {
            addAct: {
              service: AV,
              op: 'Add',
              scope: 'all',
              machines: [{ for: { kind: 'named', at: 12 }, use: 'SM' }],
            },
          },
        ],
      },
    ],
    decisions: [{ accept: 'lines' }],
    prepare: [{ machine: 'SM', how: { stock: 7 }, opensOn: 'Use existing Device' }],
    execute: [
      {
        row: {
          act: { assign: { kind: 'named', at: 12 }, machine: 'unspecified' },
          target: { stock: 7 },
        },
        date: 2,
      },
      {
        row: {
          act: { service: AV, op: 'Add', scope: 'all' },
          target: { stock: 7 },
        },
        date: 1,
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { kind: 'named', at: 12 },
          services: [],
          machines: [{ stock: 7 }],
        },
      ],
      machines: [
        {
          machine: { stock: 7 },
          holder: { kind: 'named', at: 12 },
          services: [{ service: AV, status: 'Active', start: 1 }],
        },
      ],
    },
  },
  {
    id: 'S48',
    title:
      'manager · a future person given a machine from stock with a Device service on it · date changed · created from their own view · Execute N ready on a changed date',
    asker: 'manager',
    people: [
      {
        future: {
          key: 'jn',
          label: 'Joiner',
          department: 'alpha',
          email: 'zze2e.mx.s48@example.invalid',
        },
      },
    ],
    acts: [
      { assign: { future: 'jn' }, machine: { stock: 8 } },
      { service: BACKUP, op: 'Add', scope: 'all' },
    ],
    send: 'now',
    modifications: [{ changes: [{ date: 3 }] }],
    decisions: [{ accept: 'groups' }],
    prepare: [{ person: 'jn', how: 'create', opensOn: 'Create new', ownView: true }],
    execute: [{ ready: true, date: 1 }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { future: 'jn' },
          services: [],
          machines: [{ stock: 8 }],
          department: 'alpha',
        },
      ],
      machines: [
        {
          machine: { stock: 8 },
          holder: { future: 'jn' },
          services: [{ service: BACKUP, status: 'Active', start: 1 }],
        },
      ],
    },
  },
  {
    id: 'S49',
    title:
      'manager · a service on a held machine, suspend, resume, end and a new machine asked with nothing said · date moved to the future · all refused but the end · the end row by row today',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'holder', at: 9 },
          { kind: 'device_active', at: 7 },
          { kind: 'device_suspended', at: 1 },
          { kind: 'device_active', at: 8 },
          { kind: 'bare', at: 43 },
        ],
      },
    ],
    acts: [
      {
        service: BACKUP,
        op: 'Add',
        scope: { person: { kind: 'holder', at: 9 } },
      },
      {
        service: AV,
        op: 'Suspend',
        scope: { person: { kind: 'device_active', at: 7 } },
      },
      {
        service: AV,
        op: 'Resume',
        scope: { person: { kind: 'device_suspended', at: 1 } },
      },
      {
        service: AV,
        op: 'End',
        scope: { person: { kind: 'device_active', at: 8 } },
      },
      { assign: { kind: 'bare', at: 43 }, machine: { describe: { key: 'Q' } } },
    ],
    send: 'now',
    modifications: [{ changes: [{ date: 2 }] }],
    decisions: [
      {
        refuseLine: { kind: 'holder', at: 9 },
        reason: 'ZZE2E matrix S49: no backup on that one',
      },
      {
        refuseLine: { kind: 'device_active', at: 7 },
        reason: 'ZZE2E matrix S49: still in use',
      },
      {
        refuseLine: { kind: 'device_suspended', at: 1 },
        reason: 'ZZE2E matrix S49: stays paused',
      },
      {
        refuseLine: { kind: 'bare', at: 43 },
        reason: 'ZZE2E matrix S49: no new machine this month',
      },
      { accept: 'lines' },
    ],
    execute: [
      {
        row: {
          act: { service: AV, op: 'End', scope: 'all' },
          target: { heldBy: { kind: 'device_active', at: 8 } },
        },
        date: 0,
      },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 5,
      accepted: 1,
      rejected: 4,
      people: [
        {
          who: { kind: 'holder', at: 9 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 9 } }],
        },
        {
          who: { kind: 'device_active', at: 7 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 7 } }],
        },
        {
          who: { kind: 'device_suspended', at: 1 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 1 } }],
        },
        {
          who: { kind: 'device_active', at: 8 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 8 } }],
        },
        { who: { kind: 'bare', at: 43 }, services: [], machines: [] },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 9 } },
          holder: { kind: 'holder', at: 9 },
          services: [],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 7 } },
          holder: { kind: 'device_active', at: 7 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 1 } },
          holder: { kind: 'device_suspended', at: 1 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 8 } },
          holder: { kind: 'device_active', at: 8 },
          services: [{ service: AV, status: 'Ended', start: -120, end: 0 }],
        },
      ],
    },
  },
  {
    id: 'S50',
    title:
      'manager · a machine with its Device service handed to an existing person (the service follows) and a return to stock refused · not modified · row by row',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 9 },
          { kind: 'bare', at: 40 },
          { kind: 'holder', at: 10 },
        ],
      },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'device_active', at: 9 } },
        to: { kind: 'bare', at: 40 },
        scope: { person: { kind: 'device_active', at: 9 } },
      },
      {
        giveBack: [{ heldBy: { kind: 'holder', at: 10 } }],
        scope: { person: { kind: 'holder', at: 10 } },
      },
    ],
    send: 'now',
    decisions: [
      {
        refuseLine: { heldBy: { kind: 'holder', at: 10 } },
        act: { giveBack: [{ heldBy: { kind: 'holder', at: 10 } }], scope: 'all' },
        reason: 'ZZE2E matrix S50: the machine is still needed',
      },
      { accept: 'lines' },
    ],
    execute: [
      {
        row: {
          act: {
            transfer: { heldBy: { kind: 'device_active', at: 9 } },
            to: { kind: 'bare', at: 40 },
            scope: 'all',
          },
          target: { heldBy: { kind: 'device_active', at: 9 } },
        },
        date: 1,
      },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 1,
      rejected: 1,
      people: [
        {
          who: { kind: 'device_active', at: 9 },
          services: [],
          machines: [],
          formerly: [
            {
              machine: { heldBy: { kind: 'device_active', at: 9 } },
              until: 1,
            },
          ],
        },
        {
          who: { kind: 'bare', at: 40 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 9 } }],
        },
        {
          who: { kind: 'holder', at: 10 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 10 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 9 } },
          holder: { kind: 'bare', at: 40 },
          services: [{ service: AV, status: 'Active', start: -120 }],
          formerly: [{ holder: { kind: 'device_active', at: 9 }, until: 1 }],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 10 } },
          holder: { kind: 'holder', at: 10 },
          services: [],
        },
      ],
    },
  },
  {
    id: 'S51',
    title:
      'manager · a held machine and a machine with its Device service both sent to a future person, and an end · the person replaced, then the date · both hand-overs refused · the end today',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'holder', at: 11 },
          { kind: 'device_active', at: 12 },
          { kind: 'device_active', at: 11 },
        ],
      },
      { future: { key: 'np', label: 'Nope', department: 'beta' } },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'holder', at: 11 } },
        to: { future: 'np' },
        scope: { person: { kind: 'holder', at: 11 } },
      },
      {
        transfer: { heldBy: { kind: 'device_active', at: 12 } },
        to: { future: 'np' },
        scope: { person: { kind: 'device_active', at: 12 } },
      },
      {
        service: AV,
        op: 'End',
        scope: { person: { kind: 'device_active', at: 11 } },
      },
    ],
    send: 'now',
    modifications: [
      {
        changes: [
          {
            replaceFuture: 'np',
            with: {
              key: 'np',
              label: 'Nope',
              department: 'alpha',
              email: 'zze2e.mx.s51@example.invalid',
            },
            acts: [
              {
                transfer: { heldBy: { kind: 'holder', at: 11 } },
                to: { future: 'np' },
                scope: { person: { kind: 'holder', at: 11 } },
              },
              {
                transfer: { heldBy: { kind: 'device_active', at: 12 } },
                to: { future: 'np' },
                scope: { person: { kind: 'device_active', at: 12 } },
              },
            ],
          },
        ],
      },
      { changes: [{ date: 1 }] },
    ],
    decisions: [
      {
        refuseLine: { kind: 'holder', at: 11 },
        reason: 'ZZE2E matrix S51: the newcomer is not coming',
      },
      {
        refuseLine: { kind: 'device_active', at: 12 },
        reason: 'ZZE2E matrix S51: keep it with its holder',
      },
      { accept: 'lines' },
    ],
    execute: [
      {
        row: {
          act: { service: AV, op: 'End', scope: 'all' },
          target: { heldBy: { kind: 'device_active', at: 11 } },
        },
        date: 0,
      },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 1,
      rejected: 2,
      people: [
        {
          who: { kind: 'holder', at: 11 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 11 } }],
        },
        {
          who: { kind: 'device_active', at: 12 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 12 } }],
        },
        {
          who: { kind: 'device_active', at: 11 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 11 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'holder', at: 11 } },
          holder: { kind: 'holder', at: 11 },
          services: [],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 12 } },
          holder: { kind: 'device_active', at: 12 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 11 } },
          holder: { kind: 'device_active', at: 11 },
          services: [{ service: AV, status: 'Ended', start: -120, end: 0 }],
        },
      ],
    },
  },
  {
    id: 'S52',
    title: 'manager · a Device service for people with no machine and none asked is refused at composition',
    asker: 'manager',
    people: [],
    acts: [],
    send: 'now',
    refusals: [
      {
        refusal: 'no-machine',
        act: { service: BACKUP, op: 'Add', scope: 'all' },
        people: [
          { kind: 'bare', at: 41 },
          { kind: 'bare', at: 42 },
        ],
      },
    ],
  },
  {
    id: 'S53',
    title:
      'manager · a future person given a machine from stock · date changed, then the machine swapped for another · an existing person used instead · row by row on the pre-filled date',
    asker: 'manager',
    people: [{ future: { key: 'dp', label: 'Dup', department: 'alpha' } }],
    acts: [{ assign: { future: 'dp' }, machine: { stock: 10 } }],
    send: 'now',
    modifications: [
      { changes: [{ date: 2 }] },
      {
        changes: [
          { removeAct: { assign: { future: 'dp' }, machine: { stock: 10 } } },
          { addAct: { assign: { future: 'dp' }, machine: { stock: 11 } } },
        ],
      },
    ],
    decisions: [{ accept: 'lines' }],
    prepare: [{ person: 'dp', how: { useExisting: { kind: 'bare', at: 44 } } }],
    execute: [{ row: { act: { assign: { future: 'dp' }, machine: 'unspecified' }, target: { stock: 11 } } }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [{ who: { kind: 'bare', at: 44 }, services: [], machines: [{ stock: 11 }] }],
      machines: [
        { machine: { stock: 11 }, holder: { kind: 'bare', at: 44 }, services: [] },
        { machine: { stock: 10 }, holder: null, services: [] },
      ],
    },
  },
  {
    id: 'S54',
    title:
      'manager · a future person, a new laptop with a serial and a Device service on it · not modified · an existing person used, a machine from stock used · Execute N ready on a changed date',
    asker: 'manager',
    people: [{ future: { key: 'al', label: 'Alt', department: 'beta' } }],
    acts: [
      { assign: { future: 'al' }, machine: { describe: { key: 'K', type: 'Laptop', serial: true } } },
      { service: AV, op: 'Add', scope: 'all', machines: [{ for: { future: 'al' }, use: 'K' }] },
    ],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'al', how: { useExisting: { kind: 'bare', at: 31 } } },
      { machine: 'K', how: { stock: 12 }, opensOn: 'Register new Device' },
    ],
    execute: [{ ready: true, date: 1 }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [{ who: { kind: 'bare', at: 31 }, services: [], machines: [{ stock: 12 }] }],
      machines: [
        {
          machine: { stock: 12 },
          holder: { kind: 'bare', at: 31 },
          services: [{ service: AV, status: 'Active', start: 1 }],
        },
      ],
    },
  },
  {
    id: 'S55',
    title:
      'manager · a new machine described with a Device service on it · a second Device service added before the work, then refused · registered new · row by row on different dates',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 35 }] }],
    acts: [
      {
        assign: { kind: 'bare', at: 35 },
        machine: { describe: { key: 'R1', type: 'Laptop', hostname: true, serial: true } },
      },
      { service: AV, op: 'Add', scope: 'all', machines: [{ for: { kind: 'bare', at: 35 }, use: 'R1' }] },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          {
            addAct: {
              service: BACKUP,
              op: 'Add',
              scope: { person: { kind: 'bare', at: 35 } },
              machines: [{ for: { kind: 'bare', at: 35 }, use: 'R1' }],
            },
          },
        ],
      },
    ],
    decisions: [
      {
        refuseLine: { kind: 'bare', at: 35 },
        act: { service: BACKUP, op: 'Add', scope: 'all' },
        reason: 'ZZE2E matrix S55: one protection is enough',
      },
      { accept: 'lines' },
    ],
    prepare: [{ machine: 'R1', how: 'register', opensOn: 'Register new Device' }],
    execute: [
      {
        row: { act: { assign: { kind: 'bare', at: 35 }, machine: 'unspecified' }, target: { requested: 'R1' } },
        date: 2,
      },
      { row: { act: { service: AV, op: 'Add', scope: 'all' }, target: { requested: 'R1' } }, date: 1 },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 2,
      rejected: 1,
      people: [{ who: { kind: 'bare', at: 35 }, services: [], machines: [{ requested: 'R1' }] }],
      machines: [
        {
          machine: { requested: 'R1' },
          holder: { kind: 'bare', at: 35 },
          services: [{ service: AV, status: 'Active', start: 1 }],
        },
      ],
    },
  },
  {
    id: 'S56',
    title:
      'manager · a new machine with a Device service asked for a team member · date changed · the machine used is one somebody holds, with its own service (hand-over) · row by row on different dates',
    asker: 'manager',
    people: [{ existing: [{ team: 2, at: 0 }] }],
    acts: [
      { assign: { team: 2, at: 0 }, machine: { describe: { key: 'U', hostname: true } } },
      { service: BACKUP, op: 'Add', scope: 'all', machines: [{ for: { team: 2, at: 0 }, use: 'U' }] },
    ],
    send: 'now',
    modifications: [{ changes: [{ date: 1 }] }],
    decisions: [{ accept: 'lines' }],
    prepare: [{ machine: 'U', how: { heldBy: { kind: 'device_active', at: 13 } } }],
    execute: [
      {
        row: {
          act: { assign: { team: 2, at: 0 }, machine: 'unspecified' },
          target: { heldBy: { kind: 'device_active', at: 13 } },
        },
      },
      {
        row: {
          act: { service: BACKUP, op: 'Add', scope: 'all' },
          target: { heldBy: { kind: 'device_active', at: 13 } },
        },
        date: 0,
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { team: 2, at: 0 }, services: [], machines: [{ heldBy: { kind: 'device_active', at: 13 } }] },
        {
          who: { kind: 'device_active', at: 13 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 13 } }, until: 1 }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 13 } },
          holder: { team: 2, at: 0 },
          services: [
            { service: AV, status: 'Active', start: -120 },
            { service: BACKUP, status: 'Active', start: 0 },
          ],
          formerly: [{ holder: { kind: 'device_active', at: 13 }, until: 1 }],
        },
      ],
    },
  },
  {
    id: 'S57',
    title:
      'manager · a return to stock and a resume for two people · date changed, then a Device service added · the resume group on one date, the rest Execute N ready on another',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 14 },
          { kind: 'device_suspended', at: 2 },
          { kind: 'device_suspended', at: 3 },
        ],
      },
    ],
    acts: [
      {
        giveBack: [{ heldBy: { kind: 'device_active', at: 14 } }],
        scope: { person: { kind: 'device_active', at: 14 } },
      },
      { service: AV, op: 'Resume', scope: 'all' },
    ],
    send: 'now',
    sentLines: 3,
    modifications: [
      { changes: [{ date: 2 }] },
      {
        changes: [{ addAct: { service: BACKUP, op: 'Add', scope: { person: { kind: 'device_suspended', at: 2 } } } }],
      },
    ],
    decisions: [{ accept: 'groups' }],
    execute: [
      { group: { service: AV, op: 'Resume', scope: 'all' }, date: 2 },
      { ready: true, date: 1 },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 14 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 14 } }, until: 1 }],
        },
        {
          who: { kind: 'device_suspended', at: 2 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 2 } }],
        },
        {
          who: { kind: 'device_suspended', at: 3 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 3 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 14 } },
          holder: null,
          services: [{ service: AV, status: 'Active', start: -120 }],
          formerly: [{ holder: { kind: 'device_active', at: 14 }, until: 1 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 2 } },
          holder: { kind: 'device_suspended', at: 2 },
          services: [
            { service: AV, status: 'Active', start: -120 },
            { service: BACKUP, status: 'Active', start: 1 },
          ],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 3 } },
          holder: { kind: 'device_suspended', at: 3 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
      ],
    },
  },
  {
    id: 'S58',
    title:
      'manager · a machine with its Device service handed to somebody already holding one · a machine from stock added, then the date · handed at execution to a third person with a reason, the service follows',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 15 },
          { kind: 'device_suspended', at: 5 },
        ],
      },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'device_active', at: 15 } },
        to: { kind: 'device_suspended', at: 5 },
        scope: { person: { kind: 'device_active', at: 15 } },
      },
    ],
    send: 'now',
    sentLines: 1,
    modifications: [
      {
        changes: [
          { addPeople: { existing: [{ kind: 'device_suspended', at: 4 }] } },
          { addAct: { assign: { kind: 'device_suspended', at: 4 }, machine: { stock: 13 } } },
        ],
        lines: 2,
      },
      { changes: [{ date: 1 }] },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [
      {
        row: {
          act: {
            transfer: { heldBy: { kind: 'device_active', at: 15 } },
            to: { kind: 'device_suspended', at: 5 },
            scope: 'all',
          },
          target: { heldBy: { kind: 'device_active', at: 15 } },
        },
        handTo: { to: { kind: 'device_suspended', at: 6 }, reason: 'ZZE2E matrix S58: the team lead takes it instead' },
      },
      { ready: true },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 15 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 15 } }, until: 1 }],
        },
        {
          who: { kind: 'device_suspended', at: 5 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 5 } }],
        },
        {
          who: { kind: 'device_suspended', at: 6 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 6 } }, { heldBy: { kind: 'device_active', at: 15 } }],
        },
        {
          who: { kind: 'device_suspended', at: 4 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 4 } }, { stock: 13 }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 15 } },
          holder: { kind: 'device_suspended', at: 6 },
          services: [{ service: AV, status: 'Active', start: -120 }],
          formerly: [{ holder: { kind: 'device_active', at: 15 }, until: 1 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 5 } },
          holder: { kind: 'device_suspended', at: 5 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 6 } },
          holder: { kind: 'device_suspended', at: 6 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 4 } },
          holder: { kind: 'device_suspended', at: 4 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        { machine: { stock: 13 }, holder: { kind: 'device_suspended', at: 4 }, services: [] },
      ],
    },
  },
  {
    id: 'S59',
    title:
      'manager · a machine from stock for somebody who holds one · a Device service added before the work on both their machines (the held one and the arriving one) · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'device_suspended', at: 7 }] }],
    acts: [{ assign: { kind: 'device_suspended', at: 7 }, machine: { stock: 14 } }],
    send: 'now',
    sentLines: 1,
    modifications: [{ changes: [{ addAct: { service: BACKUP, op: 'Add', scope: 'all' } }] }],
    decisions: [{ accept: 'groups' }],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_suspended', at: 7 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 7 } }, { stock: 14 }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_suspended', at: 7 } },
          holder: { kind: 'device_suspended', at: 7 },
          services: [
            { service: AV, status: 'Suspended', start: -120 },
            { service: BACKUP, status: 'Active', start: 0 },
          ],
        },
        {
          machine: { stock: 14 },
          holder: { kind: 'device_suspended', at: 7 },
          services: [{ service: BACKUP, status: 'Active', start: 0 }],
        },
      ],
    },
  },
  {
    id: 'S60',
    title:
      'manager · a machine with its Device service handed to a future person · not modified · created from their own view · row by row on the pre-filled date',
    asker: 'manager',
    people: [
      { existing: [{ kind: 'device_active', at: 10 }] },
      { future: { key: 'so', label: 'Solo', department: 'alpha', email: 'zze2e.mx.s60@example.invalid' } },
    ],
    acts: [
      {
        transfer: { heldBy: { kind: 'device_active', at: 10 } },
        to: { future: 'so' },
        scope: { person: { kind: 'device_active', at: 10 } },
      },
    ],
    send: 'now',
    decisions: [{ accept: 'lines' }],
    prepare: [{ person: 'so', how: 'create', opensOn: 'Create new', ownView: true }],
    execute: [
      {
        row: {
          act: { transfer: { heldBy: { kind: 'device_active', at: 10 } }, to: { future: 'so' }, scope: 'all' },
          target: { heldBy: { kind: 'device_active', at: 10 } },
        },
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 10 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 10 } }, until: 0 }],
        },
        {
          who: { future: 'so' },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 10 } }],
          department: 'alpha',
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 10 } },
          holder: { future: 'so' },
          services: [{ service: AV, status: 'Active', start: -120 }],
          formerly: [{ holder: { kind: 'device_active', at: 10 }, until: 0 }],
        },
      ],
    },
  },
  {
    id: 'S61',
    title:
      'manager · suspend, resume and end a Device service · not modified · the suspend from the person view on its own date, the rest Execute N ready today',
    asker: 'manager',
    people: [
      {
        existing: [
          { kind: 'device_active', at: 20 },
          { kind: 'device_suspended', at: 10 },
          { kind: 'device_active', at: 21 },
        ],
      },
    ],
    acts: [
      { service: AV, op: 'Suspend', scope: { person: { kind: 'device_active', at: 20 } } },
      { service: AV, op: 'Resume', scope: { person: { kind: 'device_suspended', at: 10 } } },
      { service: AV, op: 'End', scope: { person: { kind: 'device_active', at: 21 } } },
    ],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    execute: [
      {
        person: { kind: 'device_active', at: 20 },
        rows: [
          {
            row: {
              act: { service: AV, op: 'Suspend', scope: 'all' },
              target: { heldBy: { kind: 'device_active', at: 20 } },
            },
            date: 1,
          },
        ],
      },
      { ready: true },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 20 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 20 } }],
        },
        {
          who: { kind: 'device_suspended', at: 10 },
          services: [],
          machines: [{ heldBy: { kind: 'device_suspended', at: 10 } }],
        },
        {
          who: { kind: 'device_active', at: 21 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 21 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 20 } },
          holder: { kind: 'device_active', at: 20 },
          services: [{ service: AV, status: 'Suspended', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_suspended', at: 10 } },
          holder: { kind: 'device_suspended', at: 10 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'device_active', at: 21 } },
          holder: { kind: 'device_active', at: 21 },
          services: [{ service: AV, status: 'Ended', start: -120, end: 0 }],
        },
      ],
    },
  },
  {
    id: 'S62',
    title:
      'manager · a machine from stock for somebody who holds one, a Device service on the arriving machine · not modified · the service refused, the machine given · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'device_active', at: 22 }] }],
    acts: [
      { assign: { kind: 'device_active', at: 22 }, machine: { stock: 15 } },
      { service: AV, op: 'Add', scope: { person: { kind: 'device_active', at: 22 } } },
    ],
    send: 'now',
    decisions: [
      {
        refuseLine: { kind: 'device_active', at: 22 },
        act: { service: AV, op: 'Add', scope: 'all' },
        reason: 'ZZE2E matrix S62: the new machine comes protected already',
      },
      { accept: 'lines' },
    ],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 1,
      rejected: 1,
      people: [
        {
          who: { kind: 'device_active', at: 22 },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 22 } }, { stock: 15 }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 22 } },
          holder: { kind: 'device_active', at: 22 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        { machine: { stock: 15 }, holder: { kind: 'device_active', at: 22 }, services: [] },
      ],
    },
  },
  {
    id: 'S63',
    title:
      'manager · a future person and a new machine with nothing said · a Device service on it added, then the date changed · created from their own view, the machine registered once they exist · Execute N ready',
    asker: 'manager',
    people: [{ future: { key: 'bl', label: 'Blank', department: 'beta' } }],
    acts: [{ assign: { future: 'bl' }, machine: { describe: { key: 'V' } } }],
    send: 'now',
    sentLines: 1,
    modifications: [
      {
        changes: [
          { addAct: { service: BACKUP, op: 'Add', scope: 'all', machines: [{ for: { future: 'bl' }, use: 'V' }] } },
        ],
        lines: 2,
      },
      { changes: [{ date: 2 }] },
    ],
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'bl', how: 'create', opensOn: 'Create new', ownView: true },
      { machine: 'V', how: 'register', opensOn: 'Register new Device', waitsFor: 'bl' },
    ],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [{ who: { future: 'bl' }, services: [], machines: [{ requested: 'V' }], department: 'beta' }],
      machines: [
        {
          machine: { requested: 'V' },
          holder: { future: 'bl' },
          services: [{ service: BACKUP, status: 'Active', start: 2 }],
        },
      ],
    },
  },
  {
    id: 'S64',
    title:
      'manager · a future person and a new machine described · not modified · the machine refused, then the whole request · nothing is created',
    asker: 'manager',
    people: [{ future: { key: 'gh', label: 'Ghost', department: 'alpha' } }],
    acts: [
      {
        assign: { future: 'gh' },
        machine: { describe: { key: 'G', type: 'Laptop', hostname: true, serial: true } },
      },
    ],
    send: 'now',
    decisions: [
      { refuseLine: { future: 'gh' }, reason: 'ZZE2E matrix S64: the hire fell through' },
      { refuseRequest: 'ZZE2E matrix S64: nothing left to do in this request' },
    ],
    customerReads: true,
    outcome: { status: 'Rejected', lines: 1, accepted: 0, rejected: 1 },
  },
];
