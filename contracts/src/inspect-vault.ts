/**
 * Read and print an m402Vault's public state.
 *
 *   MIDNIGHT_NETWORK=preview M402_VAULT_ADDRESS=<hex> npx tsx src/inspect-vault.ts
 *   MIDNIGHT_NETWORK=preview npx tsx src/inspect-vault.ts <hex>
 *
 * Needs NO wallet, NO mnemonic and NO proof server — only the indexer. That is the point:
 * `contracts/client` costs ~5.2s to import and a wallet costs minutes to sync, while this
 * path (`contracts/pure`, 0.20s) answers in well under a second, so it is usable as a
 * before/after check around every step of a run and live during a demo.
 *
 * The pattern is the gateway's, in `gateway/src/ownership.ts`: an indexer public-data
 * provider plus the generated `ledger()` decoder.
 *
 * Everything printed here is PUBLIC. `mintCounter` says how many deposits have ever been
 * made, `receipts` how many payments have ever settled — but neither reveals who made them.
 * That is the privacy claim, visible as an absence: there is no payer column to print.
 */
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { WebSocket } from 'ws';

import { ledger, type Ledger } from './pure.js';
import { getConfig, type NetworkConfig } from './lib/config.js';

// Apollo's GraphQL subscriptions require a global WebSocket implementation in Node.
// @ts-expect-error Node's global WebSocket shape differs from ws only nominally.
globalThis.WebSocket ??= WebSocket;

export type ServiceRow = {
  id: string;
  price: bigint;
  owner: string;
};

/**
 * Co-located with `readVaultState` rather than in `client.ts` (which costs ~5.2s to import,
 * almost all testkit-js) so a price cross-check stays on this module's ~0.2s no-wallet path -
 * `m402 services` needs both and neither needs a wallet.
 */
export function assertExpectedPrice(expectedPrice: bigint, registeredPrice: bigint): void {
  if (registeredPrice !== expectedPrice) {
    throw new Error(
      `Gateway price ${expectedPrice} does not match on-chain price ${registeredPrice}.`,
    );
  }
}

export type VaultState = {
  address: string;
  mintCounter: bigint;
  receiptCount: bigint;
  services: ServiceRow[];
  merchantBalances: { owner: string; balance: bigint }[];
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * Reads vault state through the indexer. Returns `undefined` when the address has no state,
 * which means either "not deployed" or "deployed but not yet indexed" — the caller cannot
 * tell those apart from here and generally should not need to.
 */
export async function readVaultState(
  vaultAddress: string,
  config: NetworkConfig,
): Promise<VaultState | undefined> {
  const provider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const state = await provider.queryContractState(vaultAddress);
  if (!state) return undefined;

  const vault: Ledger = ledger(state.data);

  const services: ServiceRow[] = [];
  for (const [id, price] of vault.servicePrice) {
    services.push({
      id: hex(id),
      price,
      owner: vault.serviceOwner.member(id) ? hex(vault.serviceOwner.lookup(id)) : '(none)',
    });
  }

  const merchantBalances: { owner: string; balance: bigint }[] = [];
  for (const [owner, balance] of vault.merchantBalance) {
    merchantBalances.push({ owner: hex(owner), balance });
  }

  return {
    address: vaultAddress,
    mintCounter: vault.mintCounter,
    receiptCount: vault.receipts.size(),
    services,
    merchantBalances,
  };
}

function print(state: VaultState): void {
  // console.log, not a logger: pino's pretty transport can be torn down before it flushes.
  console.log(`\nVault ${state.address}`);
  console.log(`  mintCounter     ${state.mintCounter}   (deposits ever made)`);
  console.log(`  receipts        ${state.receiptCount}   (payments ever settled)`);

  console.log(`\n  Services (${state.services.length})`);
  if (!state.services.length) {
    console.log('    none registered yet — register one from the web app');
  }
  for (const service of state.services) {
    console.log(`    ${service.id}`);
    console.log(`      price ${service.price} STAR   owner ${service.owner.slice(0, 16)}...`);
  }

  console.log(`\n  Merchant balances (${state.merchantBalances.length})`);
  if (!state.merchantBalances.length) console.log('    none');
  for (const row of state.merchantBalances) {
    console.log(`    ${row.owner.slice(0, 16)}...  ${row.balance} STAR`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const vaultAddress = process.argv[2] ?? process.env['M402_VAULT_ADDRESS'];
  if (!vaultAddress) {
    throw new Error(
      'No vault address. Pass one as an argument or set M402_VAULT_ADDRESS.',
    );
  }

  const config = getConfig();
  const state = await readVaultState(vaultAddress, config);
  if (!state) {
    throw new Error(
      `No contract state at ${vaultAddress} on ${config.networkId}. ` +
        'Check the address and the network, or wait for the deployment to be indexed.',
    );
  }
  print(state);
}

// Only when run directly, so `init` can import readVaultState without executing this.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
