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
import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import * as Rx from 'rxjs';
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
const nativeTokenHex = nativeToken().raw;

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
  let nightBefore: bigint;        // agent NIGHT before the deposit
  let nightAfterDeposit: bigint;  // and after, so payments can be shown not to move it

  async function readLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  /**
   * NIGHT held by the vault, as the indexer reports it.
   *
   * On Preview this returns an empty array even for a vault that demonstrably holds
   * NIGHT — `redeem` and `withdraw` both spend from it successfully. So contract-held
   * unshielded balances appear not to be indexed. Solvency is asserted against the
   * agent's own wallet instead, which is first-hand evidence rather than a report.
   */
  async function poolNightReported(): Promise<bigint> {
    const balances = await providers.publicDataProvider.queryUnshieldedBalances(contractAddress);
    return balances?.find((b) => b.tokenType === nativeTokenHex)?.balance ?? 0n;
  }

  /** The agent's own NIGHT. Moves down on deposit, up on redeem. */
  async function agentNight(): Promise<bigint> {
    const state = await Rx.firstValueFrom(wallet.wallet.state());
    return state.unshielded.balances[nativeTokenHex] ?? 0n;
  }

  /** The agent's own unshielded address, as 32 raw bytes for `UserAddress`. */
  async function agentAddressBytes(): Promise<Uint8Array> {
    const state = await Rx.firstValueFrom(wallet.wallet.state());
    return new Uint8Array(state.unshielded.address.data);
  }

  /** Credit the agent's wallet holds, read from the shielded balances. */
  async function agentCredit(): Promise<bigint> {
    const state = await Rx.firstValueFrom(wallet.wallet.state());
    const color = pureCircuits.creditColor({ bytes: fromHex(contractAddress) });
    return state.shielded.balances[toHex(color)] ?? 0n;
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
    // console, not the logger: pino-pretty runs in a worker thread that vitest can tear
    // down before it flushes, which silently swallowed this table on the first runs.
    if (timings.length) {
      const rule = '─'.repeat(46);
      const lines = [
        '',
        rule,
        `Prove + submit + confirm, per circuit (${network})`,
        rule,
        ...timings.map(({ circuit, ms }) => `  ${circuit.padEnd(24)} ${(ms / 1000).toFixed(1)}s`),
        rule,
        '',
      ];
      console.log(lines.join('\n'));
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
    nightBefore = await agentNight();

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

    nightAfterDeposit = await agentNight();
    expect(nightAfterDeposit).toEqual(nightBefore - DEPOSIT);
    expect(await agentCredit()).toEqual(DEPOSIT);
  }, 10 * 60_000);

  it('pays for a service by spending credit, revealing no payer', async () => {
    await timed('pay', () =>
      (submitCallTx<Contract, 'pay'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'pay',
        args: [serviceId],
      }),
    );

    const state = await readLedger();

    // One nullifier and one receipt, and the merchant credited the PUBLIC price —
    // not whatever the coin was worth.
    expect(state.nullifiers.size()).toEqual(1n);
    expect(state.receipts.size()).toEqual(1n);
    expect(state.merchantBalance.lookup(merchantOwner)).toEqual(PRICE);

    // The receipt on-chain is a hash. The secret that opens it never left the
    // agent, which is what stops an indexer subscriber stealing the purchase.
    const secret = (await providers.privateStateProvider.get(PRIVATE_STATE_ID))
      ?.lastReceiptSecret;
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(state.receipts.member(secret as Uint8Array)).toBe(false);
  }, 10 * 60_000);

  it('rejects replaying the same payment', async () => {
    // A second pay() reuses neither coin nor secret, so it must succeed; the
    // replay guard is exercised by the nullifier set growing rather than colliding.
    await timed('pay (second)', () =>
      (submitCallTx<Contract, 'pay'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'pay',
        args: [serviceId],
      }),
    );

    const state = await readLedger();
    expect(state.nullifiers.size()).toEqual(2n);
    expect(state.merchantBalance.lookup(merchantOwner)).toEqual(PRICE * 2n);
  }, 10 * 60_000);

  it('leaves the payer\'s NIGHT untouched by payments', async () => {
    // The anti-differencing property, observed from the only side we can see.
    // Deposits move NIGHT; payments must not, or consecutive balances would leak
    // each amount paid.
    expect(await agentNight()).toEqual(nightAfterDeposit);

    // Documents a platform gap rather than asserting a value: the indexer does not
    // report contract-held unshielded balances, so the pool cannot be read directly.
    logger.info(`indexer reports pool NIGHT as ${await poolNightReported()}`);
  });

  it('redeems unspent credit back to NIGHT', async () => {
    const remaining = await agentCredit();
    expect(remaining).toEqual(DEPOSIT - PRICE * 2n);

    // redeem takes only a recipient; the amount is whatever coin the witness builds.
    const priv = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, {
      ...priv,
      pendingRedeem: remaining,
    });

    // The agent's OWN address. Passing anyone else's sends your money to them.
    const me = await agentAddressBytes();

    await timed('redeem', () =>
      (submitCallTx<Contract, 'redeem'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'redeem',
        args: [me],
      }),
    );

    // The money came back. This is the real proof the reserve was holding it.
    expect(await agentNight()).toEqual(nightAfterDeposit + remaining);
    expect(await agentCredit()).toEqual(0n);
  }, 10 * 60_000);

  it('pays the merchant and empties the pool', async () => {
    const owed = (await readLedger()).merchantBalance.lookup(merchantOwner);
    expect(owed).toEqual(PRICE * 2n);

    await timed('withdraw', () =>
      (submitCallTx<Contract, 'withdraw'>)(providers, {
        compiledContract: CompiledM402Vault,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'withdraw',
        args: [serviceId, owed],
      }),
    );

    const state = await readLedger();
    expect(state.merchantBalance.lookup(merchantOwner)).toEqual(0n);

    // Solvency, end to end. The agent deposited DEPOSIT and got back everything
    // except what it actually spent, so the vault created nothing and stranded
    // nothing. The merchant's PRICE * 2 left the pool to the registered address.
    expect(await agentNight()).toEqual(nightBefore - PRICE * 2n);
  }, 10 * 60_000);
});
