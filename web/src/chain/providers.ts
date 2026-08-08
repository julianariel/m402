import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import type { MidnightProvider, MidnightProviders, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { PROOF_SERVER_OVERRIDE } from './config';
import { indexerPublicDataProvider } from './indexerProvider';
import { FetchZkConfigProvider } from './zkConfigProvider';
import { createInMemoryPrivateStateProvider } from './privateState';
import { emptyPrivateState, type M402PrivateState } from './witnesses';
import type { VaultCircuits } from './circuits';

export const M402_PRIVATE_STATE_ID = 'M402WebState';
export type M402Providers = MidnightProviders<VaultCircuits, typeof M402_PRIVATE_STATE_ID, M402PrivateState>;

/**
 * The proof server URI isn't in ConnectedAPI.getConfiguration() (see
 * @midnight-ntwrk/dapp-connector-api's Configuration type) — the convention repo-wide
 * (contracts/lib/config.ts, gateway) is that it runs on the substrate node's host, port 6300.
 * Overridable for a dev setup that proxies or relocates it.
 */
function deriveProofServerUri(substrateNodeUri: string): string {
  if (PROOF_SERVER_OVERRIDE) return PROOF_SERVER_OVERRIDE;
  const url = new URL(substrateNodeUri);
  url.port = '6300';
  return url.toString().replace(/\/$/, '');
}

/**
 * Assembles the 6 providers submitCallTxAsync needs, from a connected Lace session. Called
 * once per connection (see wallet/WalletContext.tsx) and reused for every registerService/pay/
 * withdraw call against the one vault this app talks to.
 */
export async function createBrowserProviders(connectedApi: ConnectedAPI): Promise<M402Providers> {
  const config = await connectedApi.getConfiguration();
  setNetworkId(config.networkId);

  const proofServerUri = deriveProofServerUri(config.substrateNodeUri);
  const zkConfigProvider = new FetchZkConfigProvider<VaultCircuits>(window.location.origin);

  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await connectedApi.getShieldedAddresses();

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    // Serialize to hex for the connector; Lace adds coin inputs/change and binds the tx.
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await connectedApi.balanceUnsealedTransaction(toHex(tx.serialize()), {});
      return Transaction.deserialize('signature', 'proof', 'binding', fromHex(balancedHex));
    },
  };

  const midnightProvider: MidnightProvider = {
    // submitTransaction resolves to void, so the tx id is read off the tx itself.
    submitTx: async (tx) => {
      await connectedApi.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  return {
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(proofServerUri, zkConfigProvider),
    walletProvider,
    midnightProvider,
    privateStateProvider: createInMemoryPrivateStateProvider<typeof M402_PRIVATE_STATE_ID, M402PrivateState>(),
  };
}

export { emptyPrivateState };
