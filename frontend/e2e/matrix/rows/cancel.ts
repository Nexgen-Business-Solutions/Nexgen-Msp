import type { Scenario } from '../scenarios';

const MAIL = 'MX-MAIL';
const VPN = 'MX-VPN';
const AV = 'MX-AV';

export const CANCEL: Scenario[] = [
  {
    id: 'S100',
    title: 'manager · two future people · modified once · one future person cancelled with a reason, their work cancelled with them, the rest carried out and completed',
    asker: 'manager',
    people: [
      { future: { key: 'zc', label: 'Cancelled', department: 'alpha', username: 'zze2e.mx.s100c' } },
      { future: { key: 'zk', label: 'Kept', department: 'beta', username: 'zze2e.mx.s100k' } },
    ],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    sentLines: 2,
    modifications: [{ changes: [{ addAct: { service: VPN, op: 'Add', scope: 'all' } }], lines: 4 }],
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'zc', how: { cancel: 'ZZE2E matrix S100: will not join', takes: 2 } },
      { person: 'zk', how: 'create', opensOn: 'Create new', noCancelOnceDone: true },
    ],
    execute: [{ ready: true }],
    recap: 'By person',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 4,
      accepted: 4,
      rejected: 0,
      cancelled: 2,
      people: [
        {
          who: { future: 'zk' },
          services: [
            { service: MAIL, status: 'Active', start: 0 },
            { service: VPN, status: 'Active', start: 0 },
          ],
          machines: [],
          username: 'zze2e.mx.s100k',
          department: 'beta',
        },
      ],
    },
  },
  {
    id: 'S101',
    title: 'manager · future person with a described new machine and a Device service on it · the machine cancelled, the person created and keeps their User service',
    asker: 'manager',
    people: [{ future: { key: 'zd', label: 'Keeps mail', department: 'alpha', username: 'zze2e.mx.s101' } }],
    acts: [
      { assign: { future: 'zd' }, machine: { describe: { key: 'LT', type: 'Laptop', hostname: true, serial: true } } },
      { service: AV, op: 'Add', scope: 'all', machines: [{ for: { future: 'zd' }, use: 'LT' }] },
      { service: MAIL, op: 'Add', scope: 'all' },
    ],
    send: 'now',
    sentLines: 3,
    decisions: [{ accept: 'lines' }],
    prepare: [
      { machine: 'LT', how: { cancel: 'ZZE2E matrix S101: out of stock', takes: 2 } },
      { person: 'zd', how: 'create', opensOn: 'Create new', noCancelOnceDone: true },
    ],
    execute: [{ row: { act: { service: MAIL, op: 'Add', scope: 'all' }, target: { future: 'zd' } } }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      cancelled: 2,
      people: [
        {
          who: { future: 'zd' },
          services: [{ service: MAIL, status: 'Active', start: 0 }],
          machines: [],
          username: 'zze2e.mx.s101',
          department: 'alpha',
        },
      ],
    },
  },
  {
    id: 'S102',
    title: 'manager · future person with a described new machine and a Device service on it · the person cancelled, the machine no longer waits and is prepared for nobody, its service carried out',
    asker: 'manager',
    people: [{ future: { key: 'ze', label: 'Never came', department: 'beta', username: 'zze2e.mx.s102' } }],
    acts: [
      { service: MAIL, op: 'Add', scope: 'all' },
      { assign: { future: 'ze' }, machine: { describe: { key: 'LT', type: 'Laptop', hostname: true, serial: true } } },
      { service: AV, op: 'Add', scope: 'all', machines: [{ for: { future: 'ze' }, use: 'LT' }] },
    ],
    send: 'now',
    sentLines: 3,
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'ze', how: { cancel: 'ZZE2E matrix S102: hiring frozen', takes: 2 } },
      { machine: 'LT', how: 'register', opensOn: 'Register new Device', waitsFor: 'ze', noCancelOnceDone: true },
    ],
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      cancelled: 2,
      machines: [{ machine: { requested: 'LT' }, holder: null, services: [{ service: AV, status: 'Active', start: 0 }] }],
    },
  },
  {
    id: 'S103',
    title: 'manager · future person and a described new machine for them · both prepared, cancel is no longer offered on either resolved row',
    asker: 'manager',
    people: [{ future: { key: 'zf', label: 'Arrived', department: 'alpha', username: 'zze2e.mx.s103' } }],
    acts: [
      { service: MAIL, op: 'Add', scope: 'all' },
      { assign: { future: 'zf' }, machine: { describe: { key: 'LT', type: 'Laptop', hostname: true, serial: true } } },
    ],
    send: 'now',
    sentLines: 2,
    decisions: [{ accept: 'groups' }],
    prepare: [
      { person: 'zf', how: 'create', opensOn: 'Create new', noCancelOnceDone: true },
      { machine: 'LT', how: 'register', opensOn: 'Register new Device', noCancelOnceDone: true },
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
        {
          who: { future: 'zf' },
          services: [{ service: MAIL, status: 'Active', start: 0 }],
          machines: [{ requested: 'LT' }],
          username: 'zze2e.mx.s103',
          department: 'alpha',
        },
      ],
      machines: [{ machine: { requested: 'LT' }, holder: { future: 'zf' } }],
    },
  },
];
