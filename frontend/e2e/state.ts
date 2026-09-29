import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const E2E_STATE_DIR = process.env.MSP_E2E_STATE ?? join(tmpdir(), 'nexgen-msp-e2e');

export const statePath = (...parts: string[]) => {
  const path = join(E2E_STATE_DIR, ...parts);

  mkdirSync(dirname(path), { recursive: true });

  return path;
};
