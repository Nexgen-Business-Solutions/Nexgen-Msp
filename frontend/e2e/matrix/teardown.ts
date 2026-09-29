import { tearDownMatrix } from './ground';

export default function globalTeardown() {
  if (process.env.MSP_KEEP) return;

  tearDownMatrix();
}
