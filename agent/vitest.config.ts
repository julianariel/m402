import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `cli.test.ts` spawns the CLI as a real subprocess through tsx. That subprocess has to
    // compile and load the whole import graph, and `index.ts` eagerly imports the three
    // commands, which pull in the Midnight SDK — so even `m402 --version` takes ~9s cold.
    //
    // Vitest's default is 5s, so these three tests failed whenever the module cache was
    // cold and passed when it was warm. That is worse than a slow test: it looks like a
    // flaky CLI rather than a timeout that was never set high enough.
    //
    // The honest fix for the 9s itself is to load the commands lazily so that --help and
    // --version do not drag in the SDK. That is a change to command dispatch, not to the
    // test setup, so it is left separate.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
