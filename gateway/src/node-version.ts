/**
 * The gateway depends on `better-sqlite3`, a native module. On an unsupported Node it does
 * not fail at startup — it fails when the registry is first opened, with
 *
 *   NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 131.
 *
 * Run under the test suite, that surfaces as 25 failing gateway tests, which reads as "the
 * gateway is broken" rather than "you are on the wrong Node". It cost a session an hour.
 *
 * `.nvmrc` pins 24 and `engines` allows 22 or 24, but neither is enforced at runtime.
 * The agent CLI has the same guard in `agent/src/index.ts`; this is the gateway's copy.
 */
export function ensureSupportedNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22 && major !== 24) {
    throw new Error(
      `The m402 gateway requires Node 22 or 24; found ${process.versions.node}. Run 'nvm use'.\n` +
        'better-sqlite3 is a native module and will fail to load on any other version, ' +
        'with an error that looks like a gateway bug rather than a version mismatch.',
    );
  }
}
