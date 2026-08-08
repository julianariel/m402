import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `cli.test.ts` spawns the CLI as a real subprocess through tsx, so its tests are slower
    // than an in-process unit test and vitest's 5s default is not enough headroom.
    //
    // This used to be 30s, which was covering for a real defect rather than allowing for
    // subprocess overhead: `contracts/client` was imported at module scope, so every CLI
    // invocation paid ~5.2s to load @midnight-ntwrk/testkit-js before doing anything, and
    // `m402 --version` took 8.5-9.1s under tsx. That is over the 5s default every single
    // time, so the three tests failed deterministically, not intermittently.
    //
    // `commands/client.ts` now loads that module at the point of use, which brought
    // `--version` to ~0.7-1.1s under tsx. `cli.test.ts` asserts that number directly, so the
    // timeout no longer has to.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
