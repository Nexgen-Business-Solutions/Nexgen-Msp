import { existsSync } from 'node:fs';
import { FILE, buildGround } from './ground';

/**
 * MSP_REUSE=1 walks a company an earlier run left behind instead of building a new one, which
 * is what the watched run does: it wants the journey's own records on screen, not an empty
 * shell built a second later.
 */
export default async function globalSetup() {
  if (process.env.MSP_REUSE && existsSync(FILE)) return;

  await buildGround();
}
