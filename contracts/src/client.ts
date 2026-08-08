import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { CallTxFailedError, submitCallTxAsync } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { asContractAddress, SucceedEntirely, type ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { logger as testkitLogger, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';
import * as Rx from 'rxjs';

import { Contract, ledger, pureCircuits, zkConfigPath } from './contract.js';
import { type NetworkConfig } from './lib/config.js';
import { buildProviders, type VaultProviders } from './lib/providers.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from './lib/wallet.js';
import { emptyPrivateState, witnesses, type M402PrivateState } from './witnesses.js';

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
  onPhase?: (phase: AgentPhase) => void;
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
  const wallet = await MidnightWalletProvider.build(logger, environment(options.config), options.secret);
  await wallet.start();

  try {
    options.onPhase?.('syncing-wallet');
    await syncWallet(logger, wallet.wallet, options.syncTimeoutMs ?? 60 * 60_000);

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

type ClientCircuit = 'registerService' | 'deposit' | 'pay' | 'redeem';

async function submit<PCK extends ClientCircuit>(
  context: AgentContext,
  circuitId: PCK,
  args: PCK extends 'registerService'
    ? [Uint8Array, bigint, Uint8Array]
    : PCK extends 'deposit'
      ? [bigint]
      : PCK extends 'pay'
        ? [Uint8Array]
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

export function assertExpectedPrice(expectedPrice: bigint, registeredPrice: bigint): void {
  if (registeredPrice !== expectedPrice) {
    throw new Error(
      `Gateway price ${expectedPrice} does not match on-chain price ${registeredPrice}.`,
    );
  }
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
