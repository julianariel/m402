// The browser can't read contracts/src/managed off disk like NodeZkConfigProvider does —
// FetchZkConfigProvider (src/chain/zkConfigProvider.ts) fetches it over HTTP instead, so the
// proving/verifying keys and zkir need to be served as static assets from web/public. Run via
// predev/prebuild (see package.json); requires `npm run compile -w contracts` to have produced
// contracts/src/managed/m402Vault first.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'contracts', 'src', 'managed', 'm402Vault');
const dest = path.resolve(here, '..', 'public', 'managed', 'm402Vault');

if (!existsSync(src)) {
  console.error(
    `[copy-zk-assets] ${src} does not exist.\n` +
      'Run `npm run compile -w contracts` first (needs the `compact` CLI) to generate the zkir and prover/verifier keys.',
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-zk-assets] copied ${src} -> ${dest}`);
