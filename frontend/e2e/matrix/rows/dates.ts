import type { Scenario } from '../scenarios';

const MAIL = 'MX-MAIL';
const VPN = 'MX-VPN';

export const DATES: Scenario[] = [
  {
    id: 'S90',
    title: 'manager · one existing person · add a User service, username given · asked for a future date · one row on the pre-filled future date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 9 }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    requestedDate: 10,
    send: 'now',
    decisions: [{ accept: 'groups' }],
    execute: [{ row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { kind: 'named', at: 9 } } }],
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [{ who: { kind: 'named', at: 9 }, services: [{ service: MAIL, status: 'Active', start: 10 }] }],
    },
  },
  {
    id: 'S91',
    title: 'manager · two existing people · add a User service, usernames given · asked for a future date, moved to a later one · the group button on the pre-filled future date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 8 }, { kind: 'named', at: 7 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    requestedDate: 5,
    send: 'now',
    modifications: [{ changes: [{ date: 12 }], lines: 2 }],
    decisions: [{ accept: 'groups' }],
    execute: [{ group: { service: VPN, op: 'Add', scope: 'all' } }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { kind: 'named', at: 8 }, services: [{ service: VPN, status: 'Active', start: 12 }] },
        { who: { kind: 'named', at: 7 }, services: [{ service: VPN, status: 'Active', start: 12 }] },
      ],
    },
  },
  {
    id: 'S92',
    title: 'manager · one existing person · suspend · asked for today · a day before the request was created cannot be chosen · one row on a future date changed in the dialog',
    asker: 'manager',
    people: [{ existing: [{ kind: 'user_active', at: 15 }] }],
    acts: [{ service: MAIL, op: 'Suspend', scope: 'all' }],
    send: 'now',
    decisions: [{ accept: 'lines' }],
    execute: [
      {
        row: { act: { service: MAIL, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 15 } },
        refused: -1,
        date: 6,
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
          who: { kind: 'user_active', at: 15 },
          services: [
            { service: MAIL, status: 'Suspended', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
      ],
    },
  },
  {
    id: 'S93',
    title: 'manager · two existing people, two adds each · asked for today · each person\'s first add on its own future date, the rest Execute N ready on a third future date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'named', at: 6 }, { kind: 'named', at: 5 }] }],
    acts: [
      { service: MAIL, op: 'Add', scope: 'all' },
      { service: VPN, op: 'Add', scope: 'all' },
    ],
    send: 'now',
    decisions: [{ accept: 'lines' }],
    execute: [
      { row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { kind: 'named', at: 6 } }, date: 3 },
      { row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { kind: 'named', at: 5 } }, date: 8 },
      { ready: true, date: 15 },
    ],
    recap: 'By person',
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      people: [
        {
          who: { kind: 'named', at: 6 },
          services: [
            { service: MAIL, status: 'Active', start: 3 },
            { service: VPN, status: 'Active', start: 15 },
          ],
        },
        {
          who: { kind: 'named', at: 5 },
          services: [
            { service: MAIL, status: 'Active', start: 8 },
            { service: VPN, status: 'Active', start: 15 },
          ],
        },
      ],
    },
  },
  {
    id: 'S94',
    title: 'manager · one existing person · end · asked for a future date · a day before the request was created cannot be chosen · one row on the pre-filled future date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'user_active', at: 14 }] }],
    acts: [{ service: VPN, op: 'End', scope: 'all' }],
    requestedDate: 20,
    send: 'now',
    decisions: [{ accept: 'groups' }],
    execute: [
      {
        row: { act: { service: VPN, op: 'End', scope: 'all' }, target: { kind: 'user_active', at: 14 } },
        refused: -1,
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
          who: { kind: 'user_active', at: 14 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Ended', start: -120, end: 20 },
          ],
        },
      ],
    },
  },
];
