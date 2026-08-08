import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from 'contracts/pure';

// 'unconfirmed' covers both "id not registered on-chain yet" (the merchant's
// registerService tx may not have landed — retryable) and "vault has no
// state yet" — the caller can't distinguish those from here, and shouldn't
// need to: either way, this id isn't provably owned by the claimed address.
export type OwnershipResult = 'match' | 'mismatch' | 'unconfirmed';
export type CheckOwnership = (id: string, claimedOwner: string) => Promise<OwnershipResult>;

export function createOwnershipChecker(
  indexerUrl: string,
  indexerWsUrl: string,
  vaultAddress: string
): CheckOwnership {
  const provider = indexerPublicDataProvider(indexerUrl, indexerWsUrl);

  return async (id, claimedOwner) => {
    const state = await provider.queryContractState(vaultAddress);
    if (!state) return 'unconfirmed';

    const idBytes = Buffer.from(id, 'hex');
    const l = ledger(state.data);
    if (!l.serviceOwner.member(idBytes)) return 'unconfirmed';

    const onChainOwner = Buffer.from(l.serviceOwner.lookup(idBytes)).toString('hex');
    return onChainOwner.toLowerCase() === claimedOwner.toLowerCase() ? 'match' : 'mismatch';
  };
}
