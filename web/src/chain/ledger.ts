import { ledger, type Ledger } from 'contracts/pure';
import { indexerPublicDataProvider } from './indexerProvider';
import { INDEXER_URL, INDEXER_WS_URL } from './config';

/** One-shot read of the vault's typed public ledger state — no wallet needed, same indexer
 * VaultStatus already hits, just decoded via the compiled contract's `ledger()` instead of
 * only checking byte length. `null` means the vault has no state at this address yet. */
export async function fetchVaultLedger(vaultAddress: string): Promise<Ledger | null> {
  const provider = indexerPublicDataProvider(INDEXER_URL, INDEXER_WS_URL);
  const state = await provider.queryContractState(vaultAddress);
  return state ? ledger(state.data) : null;
}

/** Services owned by `ownerBytes` — decoded from serviceOwner, so it reflects whatever
 * registerService calls have actually confirmed, not the gateway's separate registry. */
export function servicesOwnedBy(ledgerState: Ledger, ownerBytes: Uint8Array): Uint8Array[] {
  const owner = Buffer.from(ownerBytes).toString('hex');
  const owned: Uint8Array[] = [];
  for (const [serviceId, ownerAtId] of ledgerState.serviceOwner) {
    if (Buffer.from(ownerAtId).toString('hex') === owner) owned.push(serviceId);
  }
  return owned;
}
