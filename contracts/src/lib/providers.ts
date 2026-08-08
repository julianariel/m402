import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type VaultCircuits =
  | 'registerService'
  | 'deposit'
  | 'pay'
  | 'redeem'
  | 'withdraw';

export type VaultProviders = MidnightProviders<any>;

export type ProviderStorageOptions = {
    privateStateStoreName?: string;
    midnightDbName?: string;
};

export function buildProviders(
    wallet: MidnightWalletProvider,
    zkConfigPath: string,
    config: NetworkConfig,
    storage: ProviderStorageOptions = {},
): VaultProviders {
    const zkConfigProvider = new NodeZkConfigProvider<VaultCircuits>(zkConfigPath);

    return {
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName: storage.privateStateStoreName ?? `m402-${Date.now()}`,
            // Spread it in only when set. levelPrivateStateProvider merges with
            // { ...DEFAULT_CONFIG, ...config }, and an explicit `undefined` OVERWRITES
            // the default rather than falling back to it — ClassicLevel then gets an
            // empty location and throws "first argument 'location' must be a non-empty
            // string" at deploy time.
            ...(storage.midnightDbName ? { midnightDbName: storage.midnightDbName } : {}),
            privateStoragePasswordProvider: () => process.env['M402_PRIVATE_STATE_PASSWORD'] ?? 'm402-dev-local-private-state',
            accountId: wallet.getCoinPublicKey(),
        }),
        publicDataProvider: indexerPublicDataProvider(
            config.indexer,
            config.indexerWS,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(
            config.proofServer,
            zkConfigProvider,
        ),
        walletProvider: wallet,
        midnightProvider: wallet,
    };
}
