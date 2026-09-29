import type { PeopleKind, ServiceKey, Who } from './ground';
import { ACCORD } from './rows/accord';
import { CANCEL } from './rows/cancel';
import { DATES } from './rows/dates';
import { MACHINES } from './rows/machines';
import { MACHINES2 } from './rows/machines2';
import { PEOPLE } from './rows/people';

export type Ref =
  | { kind: PeopleKind; at: number }
  | { team: number; at: number }
  | { future: string };

export type MachineRef = { stock: number } | { heldBy: Ref } | { requested: string };

export type DateSpec = number;

export type FutureSpec = {
  key: string;
  label: string;
  department?: 'alpha' | 'beta';
  email?: string;
  username?: string;
  startDate?: DateSpec;
};

export type NewMachineSpec = {
  key: string;
  type?: string;
  hostname?: boolean;
  serial?: boolean;
  sameAs?: { stock: number };
};

export type PeopleStep =
  | { existing: Ref[] }
  | { future: FutureSpec }
  | { department: number; minus?: Ref[] }
  | { everybody: true };

export type Scope = 'all' | { person: Ref } | { department: 'alpha' | 'beta' | number };

export type ServiceAct = {
  service: ServiceKey;
  op: 'Add' | 'Suspend' | 'Resume' | 'End';
  scope: Scope;
  only?: Ref[];
  machines?: { for: Ref; use?: string; describe?: NewMachineSpec }[];
  onMachines?: MachineRef[];
};

export type AssignAct = {
  assign: Ref;
  scope?: Scope;
  machine: { stock: number } | { heldBy: Ref } | { describe: NewMachineSpec } | { use: string } | 'unspecified';
};

export type TransferAct = { transfer: MachineRef; to: Ref; scope: Scope };

export type ReturnAct = { giveBack: MachineRef[]; scope: Scope };

export type Act = ServiceAct | AssignAct | TransferAct | ReturnAct;

export type Change =
  | { addAct: Act }
  | { removeAct: Act }
  | { addPeople: PeopleStep }
  | { removePerson: Ref }
  | { replaceFuture: string; with: FutureSpec; acts: Act[] }
  | { reviewImpact: Act; include?: Ref[] }
  | { date: DateSpec };

export type Modification = { by?: Who; changes: Change[]; lines?: number; afterApproval?: boolean };

export type Decision =
  | { accept: 'groups' | 'lines' }
  | { refuseLine: Ref | MachineRef; reason: string; act?: Act }
  | { refuseGroup: Act; reason: string }
  | { refuseRequest: string };

export type Preparation =
  | {
      person: string;
      how: 'create' | { useExisting: Ref } | { cancel: string; takes: number };
      department?: 'alpha' | 'beta';
      opensOn?: 'Create new';
      ownView?: true;
      noCancelOnceDone?: true;
    }
  | {
      machine: string;
      how: 'register' | { stock: number } | { heldBy: Ref } | { cancel: string; takes: number };
      opensOn?: 'Register new Device' | 'Use existing Device';
      waitsFor?: string;
      noCancelOnceDone?: true;
    };

export type RowRef = { act: Act; target: Ref | MachineRef };

export type ExecStep =
  | { ready: true; date?: DateSpec; refused?: DateSpec }
  | { group: Act; date?: DateSpec; refused?: DateSpec }
  | { row: RowRef; date?: DateSpec; handTo?: { to: Ref; reason: string }; refused?: DateSpec }
  | { person: Ref; rows?: { row: RowRef; date?: DateSpec }[]; date?: DateSpec }
  | { leaveAndReturn: true };

export type Usernames =
  | { dialog: true; taken?: boolean }
  | { rows: Ref[] };

export type HeldService = {
  service: ServiceKey;
  status: 'Active' | 'Suspended' | 'Ended' | 'Pending Setup';
  start?: DateSpec;
  end?: DateSpec;
};

export type Outcome = {
  status: 'Completed' | 'Rejected' | 'Submitted' | 'Awaiting Customer Approval';
  lines: number;
  accepted?: number;
  rejected?: number;
  people?: {
    who: Ref;
    services: HeldService[];
    machines?: MachineRef[];
    formerly?: { machine: MachineRef; until: DateSpec }[];
    username?: string;
    department?: 'alpha' | 'beta';
  }[];
  machines?: {
    machine: MachineRef;
    holder: Ref | null;
    services?: HeldService[];
    formerly?: { holder: Ref; until: DateSpec }[];
  }[];
  neverAtNexgen?: boolean;
  cancelled?: number;
};

export type Refusal =
  | { refusal: 'same-act-twice'; act: ServiceAct; people: Ref[] }
  | { refusal: 'machine-two-ways'; people: Ref[]; first: AssignAct; second: TransferAct }
  | { refusal: 'empty' }
  | { refusal: 'no-act'; people: Ref[] }
  | { refusal: 'no-machine'; act: ServiceAct; people: Ref[] }
  | { refusal: 'not-offered'; people: Ref[] }
  | { refusal: 'same-machine-twice'; people: Ref[]; first: AssignAct; again: Ref[] };

export type Scenario = {
  id: string;
  title: string;
  asker: Who;
  people: PeopleStep[];
  acts: Act[];
  requestedDate?: DateSpec;
  refusedRequestedDate?: DateSpec;
  send: 'now' | { draft: true; changes?: Change[] };
  sentLines?: number;
  modifications?: Modification[];
  notOfferedTo?: Who;
  approval?: 'approve' | { refuse: string };
  lockedAfterStart?: boolean;
  decisions?: Decision[];
  prepare?: Preparation[];
  usernames?: Usernames;
  execute?: ExecStep[];
  recap?: 'By action' | 'By person';
  complete?: boolean;
  customerReads?: boolean;
  outcome?: Outcome;
  refusals?: Refusal[];
};

const MAIL = 'MX-MAIL';
const VPN = 'MX-VPN';
const AV = 'MX-AV';

const SLICE: Scenario[] = [
  {
    id: 'S01',
    title: 'manager · one person · add a User service, username completed · Execute N ready on the pre-filled date',
    asker: 'manager',
    people: [{ existing: [{ kind: 'bare', at: 0 }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ ready: true }],
    recap: 'By action',
    complete: true,
    customerReads: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [{ who: { kind: 'bare', at: 0 }, services: [{ service: MAIL, status: 'Active', start: 0 }] }],
    },
  },
  {
    id: 'S02',
    title: 'manager · future person with a described new machine and a Device service on it · modified once · row by row on a changed date',
    asker: 'manager',
    people: [
      {
        future: {
          key: 'nc',
          label: 'Newcomer',
          department: 'alpha',
          email: 'zze2e.mx.s02@example.invalid',
          username: 'zze2e.mx.s02',
        },
      },
    ],
    acts: [
      { assign: { future: 'nc' }, machine: { describe: { key: 'LT', type: 'Laptop', hostname: true, serial: true } } },
      { service: AV, op: 'Add', scope: 'all', machines: [{ for: { future: 'nc' }, use: 'LT' }] },
    ],
    send: 'now',
    sentLines: 2,
    modifications: [{ changes: [{ addAct: { service: VPN, op: 'Add', scope: 'all' } }] }],
    decisions: [{ accept: 'lines' }],
    prepare: [
      { person: 'nc', how: 'create', opensOn: 'Create new' },
      { machine: 'LT', how: 'register', opensOn: 'Register new Device', waitsFor: 'nc' },
    ],
    execute: [
      { row: { act: { assign: { future: 'nc' }, machine: 'unspecified' }, target: { requested: 'LT' } }, date: 3 },
      { row: { act: { service: AV, op: 'Add', scope: 'all' }, target: { requested: 'LT' } }, date: 3 },
      { row: { act: { service: VPN, op: 'Add', scope: 'all' }, target: { future: 'nc' } }, date: 3 },
    ],
    recap: 'By person',
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { future: 'nc' },
          services: [{ service: VPN, status: 'Active', start: 3 }],
          machines: [{ requested: 'LT' }],
          username: 'zze2e.mx.s02',
          department: 'alpha',
        },
      ],
      machines: [
        { machine: { requested: 'LT' }, holder: { future: 'nc' }, services: [{ service: AV, status: 'Active', start: 3 }] },
      ],
    },
  },
  {
    id: 'S03',
    title: 'requester · two people, one act · draft reopened and sent · modified awaiting approval · approved · one line refused',
    asker: 'requester',
    people: [{ existing: [{ kind: 'bare', at: 1 }, { kind: 'bare', at: 2 }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: { draft: true },
    modifications: [{ by: 'requester', changes: [{ date: 2 }] }],
    approval: 'approve',
    decisions: [
      { refuseLine: { kind: 'bare', at: 2 }, reason: 'ZZE2E matrix S03: this one is leaving' },
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
        { who: { kind: 'bare', at: 1 }, services: [{ service: MAIL, status: 'Active', start: 2 }] },
        { who: { kind: 'bare', at: 2 }, services: [] },
      ],
    },
  },
  {
    id: 'S04',
    title: 'requester · one person · the company refuses it with a reason · it never reaches Nexgen',
    asker: 'requester',
    people: [{ existing: [{ kind: 'bare', at: 3 }] }],
    acts: [{ service: VPN, op: 'Add', scope: 'all' }],
    send: 'now',
    approval: { refuse: 'ZZE2E matrix S04: not this quarter' },
    customerReads: true,
    outcome: {
      status: 'Rejected',
      lines: 1,
      neverAtNexgen: true,
      people: [{ who: { kind: 'bare', at: 3 }, services: [] }],
    },
  },
  {
    id: 'S05',
    title: 'manager · a held machine with its Device service handed to a future person · modified twice · locked once work starts',
    asker: 'manager',
    people: [
      { existing: [{ kind: 'device_active', at: 0 }] },
      { future: { key: 'heir', label: 'Heir', department: 'beta' } },
    ],
    acts: [{ transfer: { heldBy: { kind: 'device_active', at: 0 } }, to: { future: 'heir' }, scope: 'all' }],
    send: 'now',
    modifications: [
      {
        changes: [
          {
            replaceFuture: 'heir',
            with: { key: 'heir', label: 'Heir', department: 'alpha', email: 'zze2e.mx.s05@example.invalid' },
            acts: [{ transfer: { heldBy: { kind: 'device_active', at: 0 } }, to: { future: 'heir' }, scope: 'all' }],
          },
        ],
      },
      { changes: [{ date: 1 }] },
    ],
    lockedAfterStart: true,
    decisions: [{ accept: 'groups' }],
    prepare: [{ person: 'heir', how: 'create', opensOn: 'Create new' }],
    execute: [{ ready: true }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 1,
      accepted: 1,
      rejected: 0,
      people: [
        {
          who: { kind: 'device_active', at: 0 },
          services: [],
          machines: [],
          formerly: [{ machine: { heldBy: { kind: 'device_active', at: 0 } }, until: 1 }],
        },
        {
          who: { future: 'heir' },
          services: [],
          machines: [{ heldBy: { kind: 'device_active', at: 0 } }],
          department: 'alpha',
        },
      ],
      machines: [
        {
          machine: { heldBy: { kind: 'device_active', at: 0 } },
          holder: { future: 'heir' },
          services: [{ service: AV, status: 'Active', start: -120 }],
        },
      ],
    },
  },
  {
    id: 'S06',
    title: 'manager · suspend, resume and end on three people · one act swapped · accepted line by line · each person on their own date',
    asker: 'manager',
    people: [
      { existing: [{ kind: 'user_active', at: 0 }, { kind: 'user_suspended', at: 0 }, { kind: 'user_active', at: 1 }] },
    ],
    acts: [
      { service: MAIL, op: 'Suspend', scope: { person: { kind: 'user_active', at: 0 } } },
      { service: MAIL, op: 'Resume', scope: { person: { kind: 'user_suspended', at: 0 } } },
      { service: MAIL, op: 'End', scope: { person: { kind: 'user_active', at: 1 } } },
    ],
    send: 'now',
    modifications: [
      {
        changes: [
          { removeAct: { service: MAIL, op: 'End', scope: { person: { kind: 'user_active', at: 1 } } } },
          { addAct: { service: VPN, op: 'End', scope: { person: { kind: 'user_active', at: 1 } } } },
        ],
      },
    ],
    decisions: [{ accept: 'lines' }],
    execute: [
      {
        person: { kind: 'user_active', at: 0 },
        rows: [{ row: { act: { service: MAIL, op: 'Suspend', scope: 'all' }, target: { kind: 'user_active', at: 0 } }, date: 1 }],
      },
      {
        person: { kind: 'user_suspended', at: 0 },
        rows: [{ row: { act: { service: MAIL, op: 'Resume', scope: 'all' }, target: { kind: 'user_suspended', at: 0 } }, date: 2 }],
      },
      {
        person: { kind: 'user_active', at: 1 },
        rows: [{ row: { act: { service: VPN, op: 'End', scope: 'all' }, target: { kind: 'user_active', at: 1 } }, date: 0 }],
      },
    ],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 3,
      accepted: 3,
      rejected: 0,
      people: [
        {
          who: { kind: 'user_active', at: 0 },
          services: [
            { service: MAIL, status: 'Suspended', start: -120 },
            { service: VPN, status: 'Active', start: -120 },
          ],
        },
        { who: { kind: 'user_suspended', at: 0 }, services: [{ service: MAIL, status: 'Active', start: -120 }] },
        {
          who: { kind: 'user_active', at: 1 },
          services: [
            { service: MAIL, status: 'Active', start: -120 },
            { service: VPN, status: 'Ended', start: -120, end: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'S07',
    title: 'manager · a Department minus one person · add a service · the group button on one changed date',
    asker: 'manager',
    people: [{ department: 0, minus: [{ team: 0, at: 2 }] }],
    acts: [{ service: MAIL, op: 'Add', scope: 'all' }],
    send: 'now',
    decisions: [{ accept: 'groups' }],
    usernames: { dialog: true },
    execute: [{ group: { service: MAIL, op: 'Add', scope: 'all' }, date: 4 }],
    complete: true,
    outcome: {
      status: 'Completed',
      lines: 2,
      accepted: 2,
      rejected: 0,
      people: [
        { who: { team: 0, at: 0 }, services: [{ service: MAIL, status: 'Active', start: 4 }] },
        { who: { team: 0, at: 1 }, services: [{ service: MAIL, status: 'Active', start: 4 }] },
        { who: { team: 0, at: 2 }, services: [] },
      ],
    },
  },
  {
    id: 'S08',
    title: 'manager · what composition refuses: the same act twice, one machine two ways, an empty request, people with no act, a Device service with no machine',
    asker: 'manager',
    people: [],
    acts: [],
    send: 'now',
    refusals: [
      { refusal: 'empty' },
      { refusal: 'no-act', people: [{ kind: 'bare', at: 4 }] },
      { refusal: 'same-act-twice', act: { service: MAIL, op: 'Add', scope: 'all' }, people: [{ kind: 'bare', at: 5 }] },
      {
        refusal: 'no-machine',
        act: { service: AV, op: 'Add', scope: 'all' },
        people: [{ kind: 'bare', at: 6 }],
      },
      {
        refusal: 'machine-two-ways',
        people: [{ kind: 'holder', at: 0 }, { kind: 'bare', at: 7 }, { kind: 'bare', at: 8 }],
        first: {
          assign: { kind: 'bare', at: 7 },
          scope: { person: { kind: 'bare', at: 7 } },
          machine: { heldBy: { kind: 'holder', at: 0 } },
        },
        second: {
          transfer: { heldBy: { kind: 'holder', at: 0 } },
          to: { kind: 'bare', at: 8 },
          scope: { person: { kind: 'holder', at: 0 } },
        },
      },
    ],
  },
];

export const SCENARIOS: Scenario[] = [...SLICE, ...PEOPLE, ...MACHINES, ...ACCORD, ...MACHINES2, ...CANCEL, ...DATES];
