import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration, waitForFunds } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../lib/config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from '../lib/wallet.js';
import { buildProviders, type VaultProviders } from '../lib/providers.js';
import { CompiledM402Vault, Contract, ledger, pureCircuits, zkConfigPath } from '../contract.js';
import { emptyPrivateState } from '../witnesses.js';

// Required for GraphQL subscriptions in Node.
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const ALICE_LOCAL_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID = 'M402AgentState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

/** Timings collected across the run, printed as one table at the end (#5). */
const timings: { circuit: string; ms: number }[] = [];

async function timed<T>(circuit: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  const ms = Math.round(performance.now() - t0);
  timings.push({ circuit, ms });
  logger.info(`⏱  ${circuit}: ${(ms / 1000).toFixed(1)}s`);
  return out;
}

/**
 * Wallet material is read from a FILE, never from argv and never from an environment
 * variable holding the words themselves — both leak through `ps` and shell history.
 * The env var here carries only a path.
 */
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
  // Tolerate numbered lists pasted out of a wallet UI: "1. word  2. word ...".
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

describe(`m402Vault (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: VaultProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const secret = resolveSecret(network);
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // Merchant identity is a Lace address; any 32 bytes stands in for the harness.
  const merchantOwner = new Uint8Array(randomBytes(32));
  const salt = new Uint8Array(randomBytes(32));
  const PRICE = 500n;
  const DEPOSIT = 5_000n;
  let serviceId: Uint8Array;

  async function readLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  beforeAll(async () => {
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

    wallet = await MidnightWalletProvider.build(logger, envConfig, secret);
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      const night = await waitForFunds(wallet.wallet, envConfig, false, wallet.unshieldedKeystore);
      logger.info(`NIGHT balance on '${network}': ${night}`);
    }

    providers = buildProviders(wallet, zkConfigPath, config);
  }, 70 * 60_000);

  afterAll(async () => {
    if (timings.length) {
      logger.info('─'.repeat(46));
      logger.info('Proof generation, per circuit');
      logger.info('─'.repeat(46));
      for (const { circuit, ms } of timings) {
        logger.info(`  ${circuit.padEnd(24)} ${(ms / 1000).toFixed(1)}s`);
      }
      logger.info('─'.repeat(46));
    }
    if (wallet) await wallet.stop();
  });

  it('deploys the vault', async () => {
    const deployed: DeployedContract<Contract> = await timed('deploy', () =>
      (deployContract<Contract>)(providers, {
        compiledContract: CompiledM402Vault,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: emptyPrivateState(),
      }),
    );

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`vault deployed: ${contractAddress}`);
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await readLedger();
    expect(state.servicePrice.isEmpty()).toBe(true);
    expect(state.nullifiers.isEmpty()).toBe(true);
    expect(state.receipts.isEmpty()).toBe(true);
  }, 10 * 60_000);

  it('registers a service under an id derived from the owner', async () => {
    // deriveServiceId is pure — the gateway and web app get the same id with no proof.
    serviceId = pureCircuits.deriveServiceId(merchantOwner, salt);

    await timed('registerService', () =>
      (submitCallTx<Contract, 'registerService'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'registerService',
        args: [salt, PRICE, merchantOwner],
      }),
    );

    const state = await readLedger();
    expect(state.servicePrice.member(serviceId)).toBe(true);
    expect(state.servicePrice.lookup(serviceId)).toEqual(PRICE);
    expect(state.serviceOwner.lookup(serviceId)).toEqual(merchantOwner);
  }, 10 * 60_000);

  it('rejects a front-run: a different owner with the same salt gets a different id', async () => {
    const attacker = new Uint8Array(randomBytes(32));
    const attackerId = pureCircuits.deriveServiceId(attacker, salt);
    // The whole point of deriving the id from the owner.
    expect(Buffer.from(attackerId).equals(Buffer.from(serviceId))).toBe(false);
  });

  it('deposits NIGHT and receives shielded credit', async () => {
    await timed('deposit', () =>
      (submitCallTx<Contract, 'deposit'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'deposit',
        args: [DEPOSIT],
      }),
    );

    const state = await readLedger();
    expect(state.mintCounter).toEqual(1n);
  }, 10 * 60_000);
});
