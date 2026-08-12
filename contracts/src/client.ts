import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { CallTxFailedError, submitCallTxAsync } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { asContractAddress, SucceedEntirely, type ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import type { FacadeState } from '@midnight-ntwrk/wallet-sdk';
import {
  FaucetClient,
  logger as testkitLogger,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import pino from 'pino';
import * as Rx from 'rxjs';

import { Contract, ledger, pureCircuits, zkConfigPath } from './contract.js';
import { assertExpectedPrice } from './inspect-vault.js';
import { type NetworkConfig } from './lib/config.js';
import { buildProviders, type VaultProviders } from './lib/providers.js';
import {
  deriveUnshieldedAddress,
  MidnightWalletProvider,
  syncWallet,
  type WalletSecret,
} from './lib/wallet.js';
import { emptyPrivateState, witnesses, type M402PrivateState } from './witnesses.js';

export { assertExpectedPrice, deriveUnshieldedAddress };

// Apollo's GraphQL subscriptions require a global WebSocket implementation in Node.
// @ts-expect-error Node's global WebSocket shape differs from ws only nominally.
globalThis.WebSocket ??= WebSocket;

export const AGENT_PRIVATE_STATE_ID = 'M402AgentState';

type ClientPrivateState = M402PrivateState & {
  readonly pendingReceiptSecret?: Uint8Array;
};

const clientWitnesses = {
  ...witnesses,
  receiptSecret(ctx: Parameters<typeof witnesses.receiptSecret>[0]): [ClientPrivateState, Uint8Array] {
    const state = ctx.privateState as ClientPrivateState;
    const secret = state.pendingReceiptSecret;
    if (!secret) {
      throw new Error('receiptSecret: prepare and persist a secret before building pay().');
    }
    const { pendingReceiptSecret: _consumed, ...nextState } = state;
    return [{ ...nextState, lastReceiptSecret: secret }, secret];
  },
};

const ClientCompiledM402Vault = CompiledContract.make('M402Vault', Contract).pipe(
  CompiledContract.withWitnesses(clientWitnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export type AgentPhase =
  | 'starting-wallet'
  | 'syncing-wallet'
  | 'proving'
  | 'submitting'
  | 'confirming';

export type AgentContextOptions = {
  config: NetworkConfig;
  contractAddress: string;
  secret: WalletSecret;
  syncTimeoutMs?: number;
  privateStateStoreName?: string;
  midnightDbName?: string;
  /** Directory for cached wallet sync state. Omit to sync from the start on every run. */
  syncCacheDir?: string;
  onPhase?: (phase: AgentPhase) => void;
  /** Per-emission sync detail, for showing that a multi-minute sync is actually moving. */
  onSyncProgress?: (summary: string) => void;
};

export type AgentContext = {
  wallet: MidnightWalletProvider;
  providers: VaultProviders;
  contractAddress: ContractAddress;
  onPhase?: (phase: AgentPhase) => void;
};

export type TransactionTiming = {
  txId: string;
  proveMs: number;
  submitMs: number;
  confirmMs: number;
  totalMs: number;
};

type SubmittedCall = {
  txId: string;
  nextPrivateState: M402PrivateState;
};

export type PreparedPayment = {
  receiptSecret: Uint8Array;
  receipt: Uint8Array;
};

export type PaymentCallbacks = {
  receiptSecret?: Uint8Array;
  onPrepared?: (payment: PreparedPayment) => Promise<void> | void;
  onSubmitted?: (payment: PreparedPayment & { txId: string }) => Promise<void> | void;
};

export type RedeemCallbacks = {
  onSubmitted?: (transaction: { txId: string }) => Promise<void> | void;
};

function environment(config: NetworkConfig): EnvironmentConfiguration {
  return {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };
}

function instrumentProofProvider(
  provider: ProofProvider,
  onPhase?: (phase: AgentPhase) => void,
): { provider: ProofProvider; readProveMs: () => number } {
  let proveMs = 0;
  return {
    provider: {
      async proveTx(unprovenTx, proveTxConfig) {
        onPhase?.('proving');
        const startedAt = performance.now();
        try {
          return await provider.proveTx(unprovenTx, proveTxConfig);
        } finally {
          proveMs += performance.now() - startedAt;
          onPhase?.('submitting');
        }
      },
    },
    readProveMs: () => Math.round(proveMs),
  };
}

export async function buildAgentContext(options: AgentContextOptions): Promise<AgentContext> {
  setNetworkId(options.config.networkId);
  const contractAddress = asContractAddress(options.contractAddress);
  testkitLogger.level = process.env['M402_DEBUG'] ? 'debug' : 'silent';
  const logger = pino({ level: process.env['M402_DEBUG'] ? 'debug' : 'silent' });

  options.onPhase?.('starting-wallet');
  const wallet = await MidnightWalletProvider.build(
    logger,
    environment(options.config),
    options.secret,
    options.syncCacheDir ? { dir: options.syncCacheDir } : undefined,
  );
  await wallet.start();

  try {
    options.onPhase?.('syncing-wallet');
    // One budget cannot serve both cases. A cold replay legitimately takes minutes - measured
    // ~12 min against Preview, and Midnight's own e2e notes quote ~1h per seed from genesis -
    // so it needs room. A restored wallet only catches up; if that is not quick, the cache is
    // not doing its job and failing fast beats waiting 45 minutes to find out.
    const syncTimeoutMs =
      options.syncTimeoutMs ?? (wallet.restoredFromCache ? 5 * 60_000 : 45 * 60_000);
    await syncWallet(logger, wallet.wallet, syncTimeoutMs, options.onSyncProgress);
    // Only after a synced state: caching a mid-sync position would resume from somewhere the
    // wallet never actually applied.
    await wallet.cacheSyncState();

    const providers = buildProviders(wallet, zkConfigPath, options.config, {
      privateStateStoreName: options.privateStateStoreName ?? 'm402-agent-private-state',
      midnightDbName: options.midnightDbName,
    });
    providers.privateStateProvider.setContractAddress(contractAddress);

    if (!(await providers.privateStateProvider.get(AGENT_PRIVATE_STATE_ID))) {
      await providers.privateStateProvider.set(AGENT_PRIVATE_STATE_ID, emptyPrivateState());
    }

    return {
      wallet,
      providers,
      contractAddress,
      onPhase: options.onPhase,
    };
  } catch (error) {
    await wallet.stop();
    throw error;
  }
}

export async function stopAgentContext(context: AgentContext): Promise<void> {
  await context.wallet.stop();
}

type ClientCircuit = 'registerService' | 'deposit' | 'pay' | 'redeem' | 'withdraw';

async function submit<PCK extends ClientCircuit>(
  context: AgentContext,
  circuitId: PCK,
  args: PCK extends 'registerService'
    ? [Uint8Array, bigint, Uint8Array]
    : PCK extends 'deposit'
      ? [bigint]
      : PCK extends 'pay'
        ? [Uint8Array]
        : PCK extends 'withdraw'
          ? [Uint8Array, bigint]
          : [Uint8Array],
  onSubmitted?: (submitted: SubmittedCall) => Promise<void> | void,
): Promise<TransactionTiming> {
  const timing = instrumentProofProvider(context.providers.proofProvider, context.onPhase);
  const providers = { ...context.providers, proofProvider: timing.provider };
  const startedAt = performance.now();

  const submitted = await (submitCallTxAsync<Contract, PCK>)(providers, {
    compiledContract: ClientCompiledM402Vault,
    contractAddress: context.contractAddress,
    privateStateId: AGENT_PRIVATE_STATE_ID,
    circuitId,
    args,
  } as never);

  const submittedAt = performance.now();
  const nextPrivateState = submitted.callTxData.private.nextPrivateState as M402PrivateState;
  let submittedCallbackError: unknown;
  try {
    await onSubmitted?.({ txId: submitted.txId, nextPrivateState });
  } catch (error) {
    submittedCallbackError = error;
  }

  context.onPhase?.('confirming');
  const finalized = await context.providers.publicDataProvider.watchForTxData(submitted.txId);
  if (finalized.status !== SucceedEntirely) {
    throw new CallTxFailedError(finalized, circuitId);
  }
  await context.providers.privateStateProvider.set(AGENT_PRIVATE_STATE_ID, nextPrivateState);
  if (submittedCallbackError) throw submittedCallbackError;

  const totalMs = Math.round(performance.now() - startedAt);
  const proveMs = timing.readProveMs();
  const submitMs = Math.max(0, Math.round(submittedAt - startedAt) - proveMs);
  return {
    txId: submitted.txId,
    proveMs,
    submitMs,
    confirmMs: Math.max(0, Math.round(performance.now() - submittedAt)),
    totalMs,
  };
}

export type RegisteredService = TransactionTiming & {
  serviceId: Uint8Array;
  owner: Uint8Array;
  salt: Uint8Array;
  price: bigint;
};

export async function registerService(
  context: AgentContext,
  price: bigint,
  salt: Uint8Array = new Uint8Array(randomBytes(32)),
): Promise<RegisteredService> {
  if (price <= 0n) throw new Error('Service price must be positive.');
  if (salt.length !== 32) throw new Error('Service salt must contain exactly 32 bytes.');

  const walletState = await Rx.firstValueFrom(context.wallet.wallet.state());
  const owner = new Uint8Array(walletState.unshielded.address.data);
  const serviceId = pureCircuits.deriveServiceId(owner, salt, price);
  const timing = await submit(context, 'registerService', [salt, price, owner]);
  return { ...timing, serviceId, owner, salt, price };
}

export async function depositCredit(
  context: AgentContext,
  amount: bigint,
): Promise<TransactionTiming> {
  if (amount <= 0n) throw new Error('Deposit amount must be positive.');
  return submit(context, 'deposit', [amount]);
}

export type PaymentResult = TransactionTiming & {
  receiptSecret: Uint8Array;
};

export type WalletSummary = {
  /** True when this run resumed from the sync cache rather than replaying the chain. */
  restoredFromCache: boolean;
  /** Unshielded NIGHT. Deposits spend it; redeems return it. */
  night: bigint;
  /** Total shielded credit held. */
  creditTotal: bigint;
  /**
   * Credit held as INDIVIDUAL coin values, largest first.
   *
   * Informational, not a spending constraint. `pay` receives a coin worth exactly `price`,
   * but the wallet's balancer splits a larger coin and takes the remainder back as change -
   * `deploy.test.ts` deposits 5000 once, pays 500 three times and redeems the 3500 left.
   * Spendability is decided by `creditTotal`; these explain how that total is made up.
   */
  creditCoins: bigint[];
};

/** Reads balances from the synced wallet. Requires no chain round-trip of its own. */
export async function summarizeWallet(context: AgentContext): Promise<WalletSummary> {
  const state = await Rx.firstValueFrom(context.wallet.wallet.state());
  const creditColor = toHex(pureCircuits.creditColor({ bytes: fromHex(context.contractAddress) }));

  const creditCoins = state.shielded.availableCoins
    .filter((entry) => entry.coin.type === creditColor)
    .map((entry) => entry.coin.value)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

  return {
    restoredFromCache: context.wallet.restoredFromCache,
    night: state.unshielded.balances[nativeToken().raw] ?? 0n,
    creditTotal: state.shielded.balances[creditColor] ?? 0n,
    creditCoins,
  };
}

/** A TOTAL deadline via race, not a per-emission one - same reasoning as `syncWallet`'s timer. */
async function waitFor<T>(
  observable: Rx.Observable<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = Rx.timer(timeoutMs).pipe(Rx.map<number, undefined>(() => undefined));
  return Rx.firstValueFrom(Rx.race(observable, deadline));
}

/**
 * Requests a faucet drip. Despite `FaucetClient.requestTokens`'s JSDoc claiming it "logs but
 * does not throw on failure," the bundled implementation has no internal try/catch at all and
 * propagates whatever axios throws (verified live: a captcha-protected endpoint 403s here) -
 * so this wraps it and never throws. `waitForNightBalance` is what actually decides whether
 * funding succeeded, by checking the balance rather than trusting this call.
 */
export async function requestFaucetDrip(
  address: string,
  faucetUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const logger = pino({ level: process.env['M402_DEBUG'] ? 'debug' : 'silent' });
  try {
    await new FaucetClient(faucetUrl, logger).requestTokens(address);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Waits for the unshielded NIGHT balance to become positive. Throws on timeout - unlike DUST
 * registration, there is nothing useful to do without NIGHT. */
export async function waitForNightBalance(
  context: AgentContext,
  timeoutMs = 180_000,
): Promise<bigint> {
  const balance = (state: FacadeState) => state.unshielded.balances[nativeToken().raw] ?? 0n;

  const state = await waitFor(
    context.wallet.wallet.state().pipe(Rx.filter((state) => balance(state) > 0n)),
    timeoutMs,
  );
  if (!state) {
    throw new Error(
      `No NIGHT balance appeared within ${Math.round(timeoutMs / 1000)}s. Fund the address and retry.`,
    );
  }
  return balance(state);
}

export type DustRegistrationResult = {
  txId: string;
  fee: bigint;
  registeredCount: number;
};

/**
 * Registers every available NIGHT UTXO for DUST generation.
 *
 * Self-funding: the registration transaction's fee is paid by the DUST the registered UTXOs
 * generate, not from the wallet's existing DUST balance, so it succeeds even at a 0 DUST
 * balance (verified on devnet at 5, 100 and 10,000 NIGHT). `waitForGeneratedDust` is a
 * best-effort safety margin, not a precondition - its timeout is swallowed rather than thrown.
 */
export async function registerForDustGeneration(
  context: AgentContext,
  timeoutMs = 120_000,
): Promise<DustRegistrationResult> {
  const wallet = context.wallet.wallet;
  const keystore = context.wallet.unshieldedKeystore;

  const state = await Rx.firstValueFrom(wallet.state());
  const nightUtxos = state.unshielded.availableCoins;
  if (nightUtxos.length === 0) {
    throw new Error('No NIGHT UTXOs available to register for DUST generation.');
  }

  const { fee } = await wallet.estimateRegistration(nightUtxos);
  await wallet.waitForGeneratedDust(nightUtxos, fee, { timeoutMs }).catch(() => undefined);

  const recipe = await wallet.registerNightUtxosForDustGeneration(
    nightUtxos,
    keystore.getPublicKey(),
    (payload) => keystore.signData(payload),
  );

  context.onPhase?.('proving');
  const finalized = await wallet.finalizeRecipe(recipe);
  context.onPhase?.('submitting');
  const txId = await wallet.submitTransaction(finalized);

  context.onPhase?.('confirming');
  const confirmed = await waitFor(
    wallet
      .state()
      .pipe(Rx.filter((s) => s.unshielded.availableCoins.some((c) => c.meta.registeredForDustGeneration))),
    timeoutMs,
  );
  const registeredCount = confirmed
    ? confirmed.unshielded.availableCoins.filter((c) => c.meta.registeredForDustGeneration).length
    : 0;

  return { txId, fee, registeredCount };
}

export async function hasReceipt(context: AgentContext, receipt: Uint8Array): Promise<boolean> {
  const state = await context.providers.publicDataProvider.queryContractState(context.contractAddress);
  if (!state) throw new Error(`Vault ${context.contractAddress} was not found on chain.`);
  return ledger(state.data).receipts.member(receipt);
}

async function servicePrice(context: AgentContext, serviceId: Uint8Array): Promise<bigint> {
  const state = await context.providers.publicDataProvider.queryContractState(context.contractAddress);
  if (!state) throw new Error(`Vault ${context.contractAddress} was not found on chain.`);
  const vault = ledger(state.data);
  if (!vault.servicePrice.member(serviceId)) throw new Error('unknown service');
  return vault.servicePrice.lookup(serviceId);
}

export async function payFor(
  context: AgentContext,
  serviceId: Uint8Array,
  expectedPrice: bigint,
  callbacks: PaymentCallbacks = {},
): Promise<PaymentResult> {
  const registeredPrice = await servicePrice(context, serviceId);
  assertExpectedPrice(expectedPrice, registeredPrice);
  const receiptSecret = callbacks.receiptSecret ?? new Uint8Array(randomBytes(32));
  if (receiptSecret.length !== 32) throw new Error('Receipt secret must contain exactly 32 bytes.');
  const prepared = {
    receiptSecret,
    receipt: pureCircuits.deriveReceipt(receiptSecret, serviceId),
  };

  // This callback writes the bearer credential outside the SDK's private-state
  // lifecycle. It must finish before submitCallTxAsync starts.
  await callbacks.onPrepared?.(prepared);
  const state = await context.providers.privateStateProvider.get(AGENT_PRIVATE_STATE_ID) as
    | ClientPrivateState
    | null;
  await context.providers.privateStateProvider.set(AGENT_PRIVATE_STATE_ID, {
    ...(state ?? emptyPrivateState()),
    pendingReceiptSecret: receiptSecret,
  });

  const timing = await submit(context, 'pay', [serviceId], async ({ txId, nextPrivateState }) => {
    const usedSecret = nextPrivateState.lastReceiptSecret;
    if (!usedSecret) throw new Error('Payment was submitted without a receipt secret.');
    await callbacks.onSubmitted?.({ ...prepared, txId });
  });
  return { ...timing, receiptSecret };
}

export async function redeemCredit(
  context: AgentContext,
  amount: bigint,
  callbacks: RedeemCallbacks = {},
): Promise<TransactionTiming> {
  if (amount <= 0n) throw new Error('Redeem amount must be positive.');

  const state = await context.providers.privateStateProvider.get(AGENT_PRIVATE_STATE_ID) as
    | M402PrivateState
    | null;
  await context.providers.privateStateProvider.set(AGENT_PRIVATE_STATE_ID, {
    ...(state ?? emptyPrivateState()),
    pendingRedeem: amount,
  });

  // Never accept a recipient from command input. redeem pays exactly this address.
  const walletState = await Rx.firstValueFrom(context.wallet.wallet.state());
  const recipient = new Uint8Array(walletState.unshielded.address.data);
  return submit(context, 'redeem', [recipient], ({ txId }) => callbacks.onSubmitted?.({ txId }));
}

/**
 * Claim a merchant's accrued balance.
 *
 * `withdraw` authenticates nobody: the payout address is read from `serviceOwner` on the
 * ledger, so whoever submits this, the NIGHT reaches the merchant who registered the
 * service. That makes it safe to submit from any funded wallet — useful when the
 * merchant's own wallet cannot build a transaction.
 *
 * `serviceId` only selects which owner to pay. Any service belonging to that owner
 * resolves to the same `merchantBalance` entry.
 */
export async function withdrawMerchantBalance(
  context: AgentContext,
  serviceId: Uint8Array,
  amount: bigint,
  callbacks: RedeemCallbacks = {},
): Promise<TransactionTiming> {
  if (amount <= 0n) throw new Error('Withdraw amount must be positive.');
  return submit(context, 'withdraw', [serviceId, amount], ({ txId }) => callbacks.onSubmitted?.({ txId }));
}
