import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Wallets inject themselves under window.midnight keyed by a UUID, not a fixed
 * name like `mnLace` — that key resolves to undefined, so it has to be enumerated.
 */
export function listWallets(): InitialAPI[] {
  const injected = window.midnight;
  return injected ? Object.values(injected) : [];
}

export function selectWallet(): InitialAPI {
  const wallets = listWallets();
  if (wallets.length === 0) {
    throw new Error('No Midnight wallet found. Install a Midnight wallet extension (e.g. Lace) and reload.');
  }
  return wallets[0];
}
