import { execFileSync } from 'node:child_process';

const BENCH = process.env.MSP_BENCH ?? '/home/admindev1/.local/bin/bench';
const SITE = process.env.MSP_SITE ?? 'msp.localhost';
const CWD = process.env.MSP_BENCH_DIR ?? '/home/admindev1/frappe-bench';

/** Run one fixture command on the site and hand back whatever it printed. */
export function run(method: string): string {
  try {
    return execFileSync(BENCH, ['--site', SITE, 'execute', method], {
      cwd: CWD,
      encoding: 'utf8',
      timeout: 300_000,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };

    throw new Error(`${method} failed\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
  }
}
