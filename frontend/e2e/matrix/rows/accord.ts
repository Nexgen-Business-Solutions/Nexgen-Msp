import type { Scenario } from '../scenarios';

const MAIL = 'MX-MAIL';
const VPN = 'MX-VPN';
const ARCH1 = 'MX-ARCH1';
const ARCH2 = 'MX-ARCH2';
const AV = 'MX-AV';
const BACKUP = 'MX-BACKUP';

export const ACCORD: Scenario[] = [
  {
    id: 'S79',
    title: 'manager · everybody · suspend one archive, end the other · a person removed · one line refused · each group with its button · refusal said at completion',
    asker: 'manager',
    people: [{ everybody: true }],
    acts: [
      { service: ARCH1, op: 'Suspend', scope: 'all' },
      { service: ARCH2, op: 'End', scope: 'all' },
    ],
    send: 'now',
    sentLines: 4,
    modifications: [{ changes: [{ removePerson: { kind: 'archive_two', at: 1 } }], lines: 3 }],
    decisions: [
      { refuseLine: { kind: 'archive_one', at: 1 }, reason: 'ZZE2E matrix S79: still in use' },
      { accept: 'groups' },
    ],
    execute: [{ group: { service: ARCH1, op: 'Suspend', scope: 'all' } }, { group: { service: ARCH2, op: 'End', scope: 'all' } }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 2,
      rejected: 1,
      people: [
        { who: { kind: 'archive_one', at: 0 }, services: [{ service: ARCH1, status: 'Suspended', start: -120 }] },
        { who: { kind: 'archive_one', at: 1 }, services: [{ service: ARCH1, status: 'Active', start: -120 }] },
        { who: { kind: 'archive_two', at: 0 }, services: [{ service: ARCH2, status: 'Ended', start: -120, end: 0 }] },
        { who: { kind: 'archive_two', at: 1 }, services: [{ service: ARCH2, status: 'Active', start: -120 }] },
      ],
    },
  },
  {
    id: 'S65',
    title: 'requester · two people · the approver who did not raise it is not offered Edit request · an act added while awaiting approval · approved · groups accepted · Execute N ready · recap by action',
    asker: 'requester',
    people: [{ existing: [{ kind: 'bare', at: 45 }, { kind: 'bare', at: 46 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    notOfferedTo: 'manager',
    modifications: [{ by: 'requester', changes: [{ addAct: { service: ARCH1, op: 'Add', scope: 'all' } }], lines: 4 }],
    approval: 'approve',
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        {
          who: { kind: 'bare', at: 45 },
          services: [
            { service: VPN, status: 'Active', start: 0 },
            { service: ARCH1, status: 'Active', start: 0 },
          ],
        },
        {
          who: { kind: 'bare', at: 46 },
          services: [
            { service: VPN, status: 'Active', start: 0 },
            { service: ARCH1, status: 'Active', start: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'S66',
    title: 'requester · one person · approved · an act swapped after the company approved, before Nexgen starts · one row on the pre-filled date · recap by person',
    asker: 'requester',
    people: [{ existing: [{ kind: 'user_active', at: 16 }] }],
    acts: [{ service: MAIL, op: 'Suspend', scope: 'all' }],
    send: 'now',
    approval: 'approve',
    modifications: [
      {
        afterApproval: true,
        changes: [
          { removeAct: { service: MAIL, op: 'Suspend', scope: 'all' } },
          { addAct: { service: VPN, op: 'Suspend', scope: 'all' } },
        ],
        lines: 1,
      },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [{ row: { act: { service: VPN, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 16 } } }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'user_active', at: 16 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S67',
    title: 'requester · two people · a person removed while awaiting approval · the company refuses it with a reason · never at Nexgen · the customer reads why',
    asker: 'requester',
    people: [{ existing: [{ kind: 'bare', at: 47 }, { kind: 'bare', at: 48 }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [{ by: 'requester', changes: [{ removePerson: { kind: 'bare', at: 48 } }], lines: 1 }],
    approval: { refuse: 'ZZE2E matrix S67: the budget is spent' },
    customerReads: true,
    outcome: {
      status: 'Rejected',
      lines: 1,
      neverAtNexgen: true,
      people: [
        { who: { kind: 'bare', at: 47 }, services: [] },
        { who: { kind: 'bare', at: 48 }, services: [] },
      ],
    },
  },
  {
    id: 'S68',
    title: 'requester · two people, resume · modified twice while awaiting approval (date, then a person removed) · approved · the effective date offered is the new one',
    asker: 'requester',
    people: [{ existing: [{ kind: 'user_suspended', at: 9 }, { kind: 'user_suspended', at: 10 }] }],
    acts: [{ service: MAIL, op: 'Resume', scope: 'all' }],
    requestedDate: 6,
    send: 'now',
    sentLines: 2,
    modifications: [
      { by: 'requester', changes: [{ date: 3 }], lines: 2 },
      { by: 'requester', changes: [{ removePerson: { kind: 'user_suspended', at: 10 } }], lines: 1 },
    ],
    approval: 'approve',
    decisions: [{ accept: 'lines' }],
    execute: [{ ready: true }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        { who: { kind: 'user_suspended', at: 9 }, services: [{ service: MAIL, status: 'Active', start: -120 }] },
        { who: { kind: 'user_suspended', at: 10 }, services: [{ service: MAIL, status: 'Suspended', start: -120 }] },
      ],
    },
  },
  {
    id: 'S69',
    title: 'manager · two people, suspend · an end added for one of them · locked once work starts · groups accepted · Execute N ready · recap by action',
    asker: 'manager',
    people: [{ existing: [{ kind: 'user_active', at: 17 }, { kind: 'user_active', at: 18 }] }],
    acts: [{ service: VPN, op: 'Suspend', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [{ addAct: { service: MAIL, op: 'End', scope: { person: { kind: 'user_active', at: 18 } } } }],
        lines: 3,
      },
    ],
    lockedAfterStart: true,
    decisions: [{ accept: 'groups' }],
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'user_active', at: 17 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 18 },
          services: [
            { service: MAIL, status: 'Ended', start: -120, end: 0 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S70',
    title: 'manager · two people, one act each · the last act of one person removed, the other keeps theirs · locked once work starts · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 49 }, { kind: 'bare', at: 50 }] }],
    acts: [
      { service: MAIL, op: 'Add', scope: { person: { kind: 'bare', at: 49 } } },
      { service: VPN, op: 'Add', scope: { person: { kind: 'bare', at: 50 } } },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [{ changes: [{ removeAct: { service: VPN, op: 'Add', scope: 'all' } }], lines: 1 }],
    lockedAfterStart: true,
    decisions: [{ accept: 'lines' }],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 49 }, services: [{ service: MAIL, status: 'Active', start: 0 }] },
        { who: { kind: 'bare', at: 50 }, services: [] },
      ],
    },
  },
  {
    id: 'S71',
    title: 'manager · one person with a username · act swapped, then a person added with their own act, the first act reviewed and kept to the first person · nothing owed · each from their person view',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 13 }] }],
    acts: [{ service: ARCH1, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 1,
    modifications: [
      {
        changes: [
          { removeAct: { service: ARCH1, op: 'Add', scope: 'all' } },
          { addAct: { service: ARCH2, op: 'Add', scope: 'all' } },
        ],
        lines: 1,
      },
      {
        changes: [
          { addPeople: { existing: [{ kind: 'named', at: 14 }] } },
          { addAct: { service: ARCH1, op: 'Add', scope: { person: { kind: 'named', at: 14 } } } },
          { reviewImpact: { service: ARCH2, op: 'Add', scope: 'all' } },
        ],
        lines: 2,
      },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [{ person: { kind: 'named', at: 13 } }, { person: { kind: 'named', at: 14 } }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { kind: 'named', at: 13 }, services: [{ service: ARCH2, status: 'Active', start: 0 }], username: 'zze2e.mx.p074' },
        { who: { kind: 'named', at: 14 }, services: [{ service: ARCH1, status: 'Active', start: 0 }], username: 'zze2e.mx.p075' },
      ],
    },
  },
  {
    id: 'S72',
    title: 'manager · one person turned into a group: a whole Department added with its own act · groups accepted · each group with its button',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 51 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 1,
    modifications: [
      {
        changes: [
          { addPeople: { department: 7 } },
          { addAct: { service: MAIL, op: 'Add', scope: { department: 7 } } },
          { reviewImpact: { service: VPN, op: 'Add', scope: 'all' } },
        ],
        lines: 4,
      },
    ],
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ group: { service: VPN, op: 'Add', scope: 'all' } }, { group: { service: MAIL, op: 'Add', scope: 'all' } }],
    recap: 'By action',
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 51 }, services: [{ service: VPN, status: 'Active', start: 0 }] },
        { who: { team: 7, at: 0 }, services: [{ service: MAIL, status: 'Active', start: 0 }] },
        { who: { team: 7, at: 1 }, services: [{ service: MAIL, status: 'Active', start: 0 }] },
        { who: { team: 7, at: 2 }, services: [{ service: MAIL, status: 'Active', start: 0 }] },
      ],
    },
  },
  {
    id: 'S73',
    title: 'manager · three people, suspend · modified three times in a row (person removed, date, act added) · rows on the new date and on their own',
    asker: 'manager',
    people: [
      { existing: [{ kind: 'user_active', at: 19 }, { kind: 'user_active', at: 20 }, { kind: 'user_active', at: 21 }] },
    ],
    acts: [{ service: MAIL, op: 'Suspend', scope: 'all' }],
    send: 'now',
    sentLines: 3,
    modifications: [
      { changes: [{ removePerson: { kind: 'user_active', at: 21 } }], lines: 2 },
      { changes: [{ date: 2 }], lines: 2 },
      {
        changes: [{ addAct: { service: VPN, op: 'Suspend', scope: { person: { kind: 'user_active', at: 19 } } } }],
        lines: 3,
      },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [
      { row: { act: { service: MAIL, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 19 } } },
      { row: { act: { service: MAIL, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 20 } }, date: 1 },
      { row: { act: { service: VPN, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 19 } } },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'user_active', at: 19 },
          services: [
            { service: MAIL, status: 'Suspended', start: -120 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 20 },
          services: [
            { service: MAIL, status: 'Suspended', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 21 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S74',
    title: "manager · a future person, username given · their details changed (removed and re-added) · then the date changed · created · the new date is offered",
    asker: 'manager',
    people: [{ future: { key: 'nf', label: 'Joiner', department: 'beta', username: 'zze2e.mx.s74' } }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    modifications: [
      {
        changes: [
          {
            replaceFuture: 'nf',
            with: {
              key: 'nf',
              label: 'Joiner',
              department: 'alpha',
              email: 'zze2e.mx.s74@example.invalid',
              username: 'zze2e.mx.s74b',
            },
            acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
          },
        ],
        lines: 1,
      },
      { changes: [{ date: 2 }], lines: 1 },
    ],
    decisions: [{ accept: 'lines' }],
    prepare: [{ person: 'nf', how: 'create', opensOn: 'Create new' }],
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { future: 'nf' },
          services: [{ service: MAIL, status: 'Active', start: 2 }],
          username: 'zze2e.mx.s74b',
          department: 'alpha',
        },
      ],
    },
  },
  {
    id: 'S75',
    title: 'manager · two people, one act · everything changed at once: a person out, a person in, the act swapped for two others, the date · Execute N ready',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 52 }, { kind: 'bare', at: 54 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    requestedDate: 1,
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          { removePerson: { kind: 'bare', at: 54 } },
          { addPeople: { existing: [{ kind: 'user_suspended', at: 11 }] } },
          { removeAct: { service: VPN, op: 'Add', scope: 'all' } },
          { addAct: { service: ARCH1, op: 'Add', scope: { person: { kind: 'bare', at: 52 } } } },
          { addAct: { service: MAIL, op: 'Resume', scope: { person: { kind: 'user_suspended', at: 11 } } } },
          { date: 4 },
        ],
        lines: 2,
      },
    ],
    decisions: [{ accept: 'lines' }],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 52 }, services: [{ service: ARCH1, status: 'Active', start: 4 }] },
        { who: { kind: 'bare', at: 54 }, services: [] },
        { who: { kind: 'user_suspended', at: 11 }, services: [{ service: MAIL, status: 'Active', start: -120 }] },
      ],
    },
  },
  {
    id: 'S76',
    title: 'manager · a whole Department · date changed · groups accepted · the group button on the pre-filled date · recap by action',
    asker: 'manager',
    people: [{ department: 3 }],
    acts: [{ service: ARCH1, op: 'Add', scope: 'all' }],
    send: 'now',
    modifications: [{ changes: [{ date: 3 }], lines: 3 }],
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ group: { service: ARCH1, op: 'Add', scope: 'all' } }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        { who: { team: 3, at: 0 }, services: [{ service: ARCH1, status: 'Active', start: 3 }] },
        { who: { team: 3, at: 1 }, services: [{ service: ARCH1, status: 'Active', start: 3 }] },
        { who: { team: 3, at: 2 }, services: [{ service: ARCH1, status: 'Active', start: 3 }] },
      ],
    },
  },
  {
    id: 'S77',
    title: 'manager · a whole Department · an act added for one member · locked once work starts · one line refused · each group with its button on a changed date · refusal said at completion',
    asker: 'manager',
    people: [{ department: 4 }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 3,
    modifications: [
      { changes: [{ addAct: { service: VPN, op: 'Add', scope: { person: { team: 4, at: 0 } } } }], lines: 4 },
    ],
    lockedAfterStart: true,
    decisions: [
      { refuseLine: { team: 4, at: 2 }, reason: 'ZZE2E matrix S77: already covered elsewhere' },
      { accept: 'groups' },
    ],
    usernames: { dialog: true },
    execute: [
      { group: { service: MAIL, op: 'Add', scope: 'all' }, date: 2 },
      { group: { service: VPN, op: 'Add', scope: 'all' }, date: 2 },
    ],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 3,
      rejected: 1,
      people: [
        {
          who: { team: 4, at: 0 },
          services: [
            { service: MAIL, status: 'Active', start: 2 },
            { service: VPN, status: 'Active', start: 2 },
          ],
        },
        { who: { team: 4, at: 1 }, services: [{ service: MAIL, status: 'Active', start: 2 }] },
        { who: { team: 4, at: 2 }, services: [] },
      ],
    },
  },
  {
    id: 'S78',
    title: 'manager · a Department minus one person · a person added, given the Department act by review and an act of their own · one line of the Department refused · the group button, then one row on a changed date',
    asker: 'manager',
    people: [{ department: 5, minus: [{ team: 5, at: 0 }] }],
    acts: [{ service: ARCH2, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          { addPeople: { existing: [{ kind: 'bare', at: 53 }] } },
          { addAct: { service: VPN, op: 'Add', scope: { person: { kind: 'bare', at: 53 } } } },
          { reviewImpact: { service: ARCH2, op: 'Add', scope: 'all' }, include: [{ kind: 'bare', at: 53 }] },
        ],
        lines: 4,
      },
    ],
    decisions: [
      { refuseLine: { team: 5, at: 2 }, reason: 'ZZE2E matrix S78: not needed in this team' },
      { accept: 'lines' },
    ],
    usernames: { dialog: true },
    execute: [
      { group: { service: ARCH2, op: 'Add', scope: 'all' } },
      { row: { act: { service: VPN, op: 'Add', scope: 'all' }, target: { kind: 'bare', at: 53 } }, date: 1 },
    ],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 3,
      rejected: 1,
      people: [
        { who: { team: 5, at: 0 }, services: [] },
        { who: { team: 5, at: 1 }, services: [{ service: ARCH2, status: 'Active', start: 0 }] },
        { who: { team: 5, at: 2 }, services: [] },
        {
          who: { kind: 'bare', at: 53 },
          services: [
            { service: ARCH2, status: 'Active', start: 0 },
            { service: VPN, status: 'Active', start: 1 },
          ],
        },
      ],
    },
  },
  {
    id: 'S80',
    title: 'manager · a Department minus one person and one more person · date and an act changed · the whole Department group refused, the other accepted · recap by person',
    asker: 'manager',
    people: [{ department: 6, minus: [{ team: 6, at: 2 }] }, { existing: [{ kind: 'bare', at: 55 }] }],
    acts: [
      { service: MAIL, op: 'Add', scope: { department: 6 } },
      { service: ARCH2, op: 'Add', scope: { person: { kind: 'bare', at: 55 } } },
    ],
    send: 'now',
    sentLines: 3,
    modifications: [
      {
        changes: [{ date: 6 }, { addAct: { service: VPN, op: 'Add', scope: { person: { kind: 'bare', at: 55 } } } }],
        lines: 4,
      },
    ],
    decisions: [
      { refuseGroup: { service: MAIL, op: 'Add', scope: 'all' }, reason: 'ZZE2E matrix S80: the team keeps its own mail' },
      { accept: 'groups' },
    ],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 2,
      rejected: 2,
      people: [
        { who: { team: 6, at: 0 }, services: [] },
        { who: { team: 6, at: 1 }, services: [] },
        { who: { team: 6, at: 2 }, services: [] },
        {
          who: { kind: 'bare', at: 55 },
          services: [
            { service: ARCH2, status: 'Active', start: 6 },
            { service: VPN, status: 'Active', start: 6 },
          ],
        },
      ],
    },
  },
  {
    id: 'S81',
    title: 'requester · two people · an act added while awaiting approval · approved · Nexgen refuses every group, then the request · the customer reads why',
    asker: 'requester',
    people: [{ existing: [{ kind: 'user_active', at: 22 }, { kind: 'user_active', at: 23 }] }],
    acts: [{ service: VPN, op: 'End', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        by: 'requester',
        changes: [{ addAct: { service: MAIL, op: 'Suspend', scope: 'all' } }],
        lines: 4,
      },
    ],
    approval: 'approve',
    decisions: [
      { refuseGroup: { service: VPN, op: 'End', scope: 'all' }, reason: 'ZZE2E matrix S81: the VPN stays for now' },
      { refuseGroup: { service: MAIL, op: 'Suspend', scope: 'all' }, reason: 'ZZE2E matrix S81: the mailbox stays open' },
      { refuseRequest: 'ZZE2E matrix S81: out of contract scope' },
    ],
    customerReads: true,
    outcome: {
      status: 'Rejected',
      lines: 4,
      people: [
        {
          who: { kind: 'user_active', at: 22 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 23 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S82',
    title: 'manager · three people · act swapped, then an act added · one row, page left, come back by clicks, another row on its own date, the rest ready · recap by person',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 56 }, { kind: 'bare', at: 57 }, { kind: 'bare', at: 58 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 3,
    modifications: [
      {
        changes: [
          { removeAct: { service: VPN, op: 'Add', scope: 'all' } },
          { addAct: { service: MAIL, op: 'Add', scope: 'all' } },
        ],
        lines: 3,
      },
      { changes: [{ addAct: { service: ARCH1, op: 'Add', scope: { person: { kind: 'bare', at: 58 } } } }], lines: 4 },
    ],
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [
      { row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { kind: 'bare', at: 56 } }, date: 1 },
      { leaveAndReturn: true },
      { row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { kind: 'bare', at: 57 } }, date: 3 },
      { ready: true },
    ],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        { who: { kind: 'bare', at: 56 }, services: [{ service: MAIL, status: 'Active', start: 1 }] },
        { who: { kind: 'bare', at: 57 }, services: [{ service: MAIL, status: 'Active', start: 3 }] },
        {
          who: { kind: 'bare', at: 58 },
          services: [
            { service: MAIL, status: 'Active', start: 0 },
            { service: ARCH1, status: 'Active', start: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'S83',
    title: 'manager · one person, a User service and a service on their machine · the machine act swapped for another Device service · from their person view',
    asker: 'manager',
    people: [{ existing: [{ kind: 'device_active', at: 16 }] }],
    acts: [
      { service: MAIL, op: 'Add', scope: 'all' },
      { service: AV, op: 'Suspend', scope: 'all' },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        changes: [
          { removeAct: { service: AV, op: 'Suspend', scope: 'all' } },
          { addAct: { service: BACKUP, op: 'Add', scope: 'all' } },
        ],
        lines: 2,
      },
    ],
    decisions: [{ accept: 'lines' }],
    usernames: { dialog: true },
    execute: [{ person: { kind: 'device_active', at: 16 } }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 16 },
          services: [{ service: MAIL, status: 'Active', start: 0 }],
          machines: [{ heldBy: { kind: 'device_active', at: 16 } }],
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 16 } },
          holder: { kind: 'device_active', at: 16 },
          services: [
            { service: AV, status: 'Active', start: -120 },
            { service: BACKUP, status: 'Active', start: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'S84',
    title: 'manager · mixed people and scopes · modified three times (a machine holder added with a Device act, an act removed, its person removed) · Execute N ready on a changed date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'device_suspended', at: 8 }, { kind: 'user_suspended', at: 12 }] }],
    acts: [
      { service: AV, op: 'Resume', scope: { person: { kind: 'device_suspended', at: 8 } } },
      { service: VPN, op: 'Add', scope: { person: { kind: 'device_suspended', at: 8 } } },
      { service: MAIL, op: 'End', scope: { person: { kind: 'user_suspended', at: 12 } } },
    ],
    send: 'now',
    sentLines: 3,
    modifications: [
      {
        changes: [
          { addPeople: { existing: [{ kind: 'holder', at: 12 }] } },
          { addAct: { service: AV, op: 'Add', scope: { person: { kind: 'holder', at: 12 } } } },
        ],
        lines: 4,
      },
      { changes: [{ removeAct: { service: MAIL, op: 'End', scope: 'all' } }], lines: 3 },
      { changes: [{ removePerson: { kind: 'user_suspended', at: 12 } }], lines: 3 },
    ],
    decisions: [{ accept: 'lines' }],
    usernames: { dialog: true },
    execute: [{ ready: true, date: 2 }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_suspended', at: 8 },
          services: [{ service: VPN, status: 'Active', start: 2 }],
          machines: [{ heldBy: { kind: 'device_suspended', at: 8 } }],
        },
        {
          who: { kind: 'holder', at: 12 },
          services: [],
          machines: [{ heldBy: { kind: 'holder', at: 12 } }],
        },
        { who: { kind: 'user_suspended', at: 12 }, services: [{ service: MAIL, status: 'Suspended', start: -120 }] },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_suspended', at: 8 } },
          holder: { kind: 'device_suspended', at: 8 },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
        {
          machine: { heldBy: { kind: 'holder', at: 12 } },
          holder: { kind: 'holder', at: 12 },
          services: [{ service: AV, status: 'Active', start: 2 }],
        },
      ],
    },
  },
  {
    id: 'S85',
    title: 'requester · three people · approved · a person removed after the company approved · one line refused · Execute N ready · the customer reads the refusal',
    asker: 'requester',
    people: [
      { existing: [{ kind: 'user_active', at: 24 }, { kind: 'user_active', at: 25 }, { kind: 'user_active', at: 26 }] },
    ],
    acts: [{ service: ARCH2, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 3,
    approval: 'approve',
    modifications: [{ afterApproval: true, changes: [{ removePerson: { kind: 'user_active', at: 25 } }], lines: 2 }],
    decisions: [
      { refuseLine: { kind: 'user_active', at: 26 }, reason: 'ZZE2E matrix S85: no archive for this role' },
      { accept: 'lines' },
    ],
    usernames: { dialog: true },
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
          who: { kind: 'user_active', at: 24 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
            { service: ARCH2, status: 'Active', start: 0 },
          ],
        },
        {
          who: { kind: 'user_active', at: 25 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 26 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S86',
    title: 'requester · two people · one swapped for another who gets the act by review and one more while awaiting approval · approved · groups accepted · rows on different dates',
    asker: 'requester',
    people: [{ existing: [{ kind: 'user_active', at: 27 }, { kind: 'user_active', at: 28 }] }],
    acts: [{ service: VPN, op: 'Suspend', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [
      {
        by: 'requester',
        changes: [
          { removePerson: { kind: 'user_active', at: 28 } },
          { addPeople: { existing: [{ kind: 'user_active', at: 29 }] } },
          { addAct: { service: MAIL, op: 'Suspend', scope: { person: { kind: 'user_active', at: 29 } } } },
          { reviewImpact: { service: VPN, op: 'Suspend', scope: 'all' }, include: [{ kind: 'user_active', at: 29 }] },
        ],
        lines: 3,
      },
    ],
    approval: 'approve',
    decisions: [{ accept: 'groups' }],
    execute: [
      { row: { act: { service: VPN, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 27 } }, date: 1 },
      { row: { act: { service: MAIL, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 29 } }, date: 3 },
      { row: { act: { service: VPN, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 29 } }, date: 2 },
    ],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'user_active', at: 27 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 28 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
        {
          who: { kind: 'user_active', at: 29 },
          services: [
            { service: MAIL, status: 'Suspended', start: -120 },
            { service: VPN, status: 'Suspended', start: -120 },
          ],
        },
      ],
    },
  },
];
