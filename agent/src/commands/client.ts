/**
 * Lazy access to `contracts/client`.
 *
 * Importing `contracts/client` costs ~5.2s, and almost all of it is
 * `@midnight-ntwrk/testkit-js`, reached through `FluentWalletBuilder` in
 * `contracts/src/lib/wallet.ts`. (Measured on Node 24: `contracts/client` 5.20s, testkit-js
 * alone 5.65s, bare node 0.11s. The gateway imports `contracts/pure` instead and pays 0.20s,
 * so this is one package, not "the SDK".)
 *
 * Nothing needs any of it until a wallet is actually built, so `--version`, `--help`, a
 * mistyped command and `call --dry-run` should never pay for it. Every call site loads the
 * module through here at the point of use rather than at module scope.
 *
 * `agent/src/test/cli.test.ts` asserts the resulting startup time, so a top-level
 * `import ... from 'contracts/client'` added anywhere in this directory fails the suite.
 */
export const loadClient = () => import('contracts/client');
