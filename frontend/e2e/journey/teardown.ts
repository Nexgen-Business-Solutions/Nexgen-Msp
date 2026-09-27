import { tearDownGround } from './ground';

/** MSP_KEEP=1 leaves the company standing, for a watched run to walk afterwards. */
export default function globalTeardown() {
  if (process.env.MSP_KEEP) return;

  tearDownGround();
}
