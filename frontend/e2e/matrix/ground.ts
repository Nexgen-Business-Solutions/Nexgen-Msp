import { readFileSync, writeFileSync } from 'node:fs';
import { run } from '../bench';
import { statePath } from '../state';

export const FILE = statePath('matrix', 'matrix.json');

export type Who = 'admin' | 'technician' | 'manager' | 'operator' | 'requester';

export type PeopleKind =
  | 'bare'
  | 'named'
  | 'user_active'
  | 'user_suspended'
  | 'device_active'
  | 'device_suspended'
  | 'holder'
  | 'archive_one'
  | 'archive_two';

export type ServiceKey = 'MX-MAIL' | 'MX-VPN' | 'MX-ARCH1' | 'MX-ARCH2' | 'MX-AV' | 'MX-BACKUP';

export type Counts = Record<string, { matrix: number; other_tests: number; real: number }>;

export type MatrixGround = {
  customer: string;
  password: string;
  departments: { alpha: string; beta: string };
  services: Record<ServiceKey, string>;
  people: Record<PeopleKind, string[]>;
  held: Record<string, string>;
  stock: string[];
  teams: Record<string, string[]>;
  counts_before: Counts;
  counts_after: Counts;
} & Record<Who | `${Who}_secret`, string>;

export type Assignment = { service: string; status: string; start: string; end: string };

export type Facts = {
  total: number;
  count: number;
  request: {
    name: string;
    status: string;
    requested_date: string;
    requester: string;
    rejection_reason: string | null;
    modified_by: string;
  } | null;
  lines: {
    idx: number;
    operation: string;
    status: string;
    reason: string | null;
    person: string | null;
    machine: string | null;
    service: string | null;
    holder: string | null;
    date: string;
  }[];
  work_orders: {
    line: number;
    operation: string;
    status: string;
    date: string;
    person: string | null;
    machine: string | null;
    service: string | null;
    holder: string | null;
    origin: string;
    override_reason: string | null;
  }[];
  requested_people: {
    name: string;
    department: string | null;
    username: string | null;
    email: string | null;
    status: string;
    mode: string | null;
    resolved: string | null;
    cancel_reason?: string | null;
  }[];
  requested_machines: {
    label: string;
    hostname: string | null;
    serial: string | null;
    type: string | null;
    status: string;
    mode: string | null;
    resolved: string | null;
    cancel_reason?: string | null;
  }[];
  people: Record<
    string,
    { exists: number; username?: string | null; department?: string; machines?: string[]; services?: Assignment[] }
  >;
  machines: Record<
    string,
    { exists: number; status?: string; serial?: string; type?: string; holder?: string | null; services?: Assignment[] }
  >;
};

const json = <T>(printed: string) =>
  JSON.parse(printed.slice(printed.indexOf('{'), printed.lastIndexOf('}') + 1)) as T;

export const buildMatrix = (): MatrixGround => {
  const cleared = json<{ residue: Record<string, number> }>(run('nexgen_msp.utils.e2e_fixture.matrix_teardown'));

  console.log(`matrix: earlier residue cleared ${JSON.stringify(cleared.residue)}`);

  const ground = json<MatrixGround>(run('nexgen_msp.utils.e2e_fixture.matrix_ground'));

  console.log(`matrix: real data before the run ${JSON.stringify(ground.counts_before)}`);
  writeFileSync(FILE, JSON.stringify(ground, null, 2));

  return ground;
};

export const tearDownMatrix = () => {
  const printed = json<{ counts_before: Counts; counts_after: Counts; residue: Record<string, number> }>(
    run('nexgen_msp.utils.e2e_fixture.matrix_teardown')
  );

  console.log(`matrix: real data after the run ${JSON.stringify(printed.counts_after)}`);
  console.log(`matrix: residue ${JSON.stringify(printed.residue)}`);

  return printed;
};

export const matrix: MatrixGround = (() => {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as MatrixGround;
  } catch {
    return {} as MatrixGround;
  }
})();

export const readMatrixFacts = (note: string, people: string[] = [], machines: string[] = []): Facts =>
  json<Facts>(run('nexgen_msp.utils.e2e_fixture.matrix_facts', { note, people, machines }));
