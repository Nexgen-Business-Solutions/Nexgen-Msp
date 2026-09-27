import { run } from './bench';

/** Whatever the run wrote goes away again, pass or fail. */
export default function globalTeardown() {
  run('nexgen_msp.utils.e2e_fixture.teardown');
}
