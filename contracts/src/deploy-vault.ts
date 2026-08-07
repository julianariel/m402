/**
 * Deploy ONE persistent m402Vault and print its address.
 *
 * The test suite deploys a throwaway vault on every run, which is right for tests and
 * useless for everyone else: the gateway, the web app and the agent CLI must all point at
 * the SAME vault or a payment lands somewhere the gateway is not watching. This script
 * produces that shared address.
 *
 *   cd contracts
 *   MIDNIGHT_NETWORK=preview \
 *   MIDNIGHT_PREVIEW_MNEMONIC_FILE=/path/to/.mnemonic \
 *   npx tsx src/deploy-vault.ts
 *
 * Requires the proof server on 127.0.0.1:6300 and a Preview wallet holding tNIGHT that is
 * registered for DUST. Takes about 3 minutes, most of it wallet sync.
 *
 * Wallet material is read from a FILE. Never pass a seed phrase in argv or in an
 * environment variable — both leak through `ps` and shell history. The env var below
 * carries only a path.
 */
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type EnvironmentConfiguration, waitForFunds } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './lib/config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from './lib/wallet.js';
import { buildProviders } from './lib/providers.js';
import { CompiledM402Vault, Contract, zkConfigPath } from './contract.js';
import { emptyPrivateState } from './witnesses.js';

// Apollo's GraphQL subscriptions require a global WebSocket implementation in Node.
// @ts-expect-error Node's global WebSocket shape differs from ws only nominally.
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const PRIVATE_STATE_ID = 'M402AgentState';
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const ALICE_LOCAL_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

function resolveSecret(net: string): WalletSecret {
  if (net === 'local') return { kind: 'seed', value: ALICE_LOCAL_SEED };

  const upper = net.toUpperCase();
  const file =
    process.env[`MIDNIGHT_${upper}_MNEMONIC_FILE`] ?? process.env['MIDNIGHT_MNEMONIC_FILE'];
  if (!file) {
    throw new Error(
      `Set MIDNIGHT_${upper}_MNEMONIC_FILE to a path holding the 24-word phrase ` +
        '(mode 600, gitignored). Never pass the words themselves in argv or an env var.',
    );
  }

  const raw = readFileSync(file, 'utf8');
  const mnemonic = raw
    .replace(/\d+[.)]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const words = mnemonic.split(' ').filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error(`${file}: expected a 12–24 word mnemonic, found ${words.length} words.`);
  }
  return { kind: 'mnemonic', value: words.join(' ') };
}

async function main(): Promise<void> {
  const config = getConfig();
  const secret = resolveSecret(network);
  const isRemote = network !== 'local';

  setNetworkId(config.networkId);
  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  logger.info(`deploying m402Vault to '${network}'`);
  const wallet = await MidnightWalletProvider.build(logger, envConfig, secret);
  await wallet.start();
  await syncWallet(
    logger,
    wallet.wallet,
    Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000)),
  );

  if (isRemote) {
    const night = await waitForFunds(wallet.wallet, envConfig, false, wallet.unshieldedKeystore);
    logger.info(`NIGHT balance on '${network}': ${night}`);
  }

  const providers = buildProviders(wallet, zkConfigPath, config);

  const t0 = performance.now();
  const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
    compiledContract: CompiledM402Vault,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: emptyPrivateState(),
  });
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);

  const address = deployed.deployTxData.public.contractAddress;

  // console, not the logger: pino-pretty runs in a worker thread that can be torn down
  // before it flushes, which is how a deploy address has been lost before.
  console.log(
    [
      '',
      '─'.repeat(72),
      `m402Vault deployed to ${network} in ${seconds}s`,
      '─'.repeat(72),
      '',
      `  M402_VAULT_ADDRESS=${address}`,
      '',
      '  Record it in contracts/README.md and share it with the gateway, web and CLI.',
      '  All three must point at THIS vault — a payment to a different one lands where',
      '  the gateway is not watching.',
      '─'.repeat(72),
      '',
    ].join('\n'),
  );

  await wallet.stop();
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
