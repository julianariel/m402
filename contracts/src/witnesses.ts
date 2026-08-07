import { randomBytes } from 'node:crypto';
import {
  createShieldedCoinInfo,
  encodeShieldedCoinInfo,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { pureCircuits, type Witnesses } from './managed/m402Vault/contract/index.js';

/**
 * A coin in Compact's representation — `color`, not the ledger's `type`, and raw bytes
 * rather than hex. `encodeShieldedCoinInfo` converts between the two.
 */
type CompactCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/**
 * Private state for an m402 agent.
 *
 * Everything here is unrecoverable if lost. `credits` holds the spendable coins;
 * `receiptSecrets` is what proves a past purchase to an auditor.
 */
export type M402PrivateState = {
  /** Unspent credit coins, most recent first. */
  readonly credits: readonly CompactCoin[];
  /** serviceId hex -> the receipt secrets used against it. */
  readonly receiptSecrets: Readonly<Record<string, readonly Uint8Array[]>>;
  /** Amount to cash out; set by the caller before `redeem`. */
  readonly pendingRedeem?: bigint;
  /** Last values handed to the circuit, so the caller can persist them after. */
  readonly lastNonceSeed?: Uint8Array;
  readonly lastReceiptSecret?: Uint8Array;
};

export const emptyPrivateState = (): M402PrivateState => ({
  credits: [],
  receiptSecrets: {},
});

type Ctx = { privateState: M402PrivateState; contractAddress: string };

/**
 * Fresh CSPRNG bytes, every call. This single function carries the unlinkability
 * of every payment funded by the resulting deposit.
 *
 * A deterministic seed does NOT fail loudly: `evolveNonce` mixes in the public
 * `mintCounter`, so nonces still come out distinct and non-colliding, every test
 * passes, and every payment becomes linkable to its depositor. Never derive this
 * from the wallet seed, the contract address, a counter, or a timestamp.
 */
export const nonceSeed = (
  ctx: Ctx,
): [M402PrivateState, Uint8Array] => {
  const seed = new Uint8Array(randomBytes(32));
  return [{ ...ctx.privateState, lastNonceSeed: seed }, seed];
};

/**
 * Fresh CSPRNG bytes, every call. The bearer credential for one purchase: only
 * `hash("m402:receipt:v1", secret, serviceId)` reaches the chain, so whoever holds
 * the secret can redeem. Release it only in the `X-Payment` header, over TLS,
 * after the payment confirms.
 */
export const receiptSecret = (
  ctx: Ctx,
): [M402PrivateState, Uint8Array] => {
  const secret = new Uint8Array(randomBytes(32));
  return [{ ...ctx.privateState, lastReceiptSecret: secret }, secret];
};

/**
 * The coin handed to the vault.
 *
 * This *describes an output*, it does not pick an existing coin. `receiveShielded`
 * requires a coin of this colour and value to appear as an output to the contract,
 * and the wallet's balancing step funds it — spending a larger credit coin and
 * returning the remainder to itself as a hidden-value Zswap output. So the split
 * happens at the Zswap layer for free, and `pay` consuming the whole coin costs
 * nothing.
 *
 * Value is exactly `price`. The circuit accepts `>=`, but anything above `price`
 * would land in the pool unclaimable.
 */
export const creditCoin = (
  ctx: Ctx,
  _serviceId: Uint8Array,
  price: bigint,
): [M402PrivateState, CompactCoin] => {
  const color = pureCircuits.creditColor({ bytes: fromHex(ctx.contractAddress) });
  return [ctx.privateState, encodeShieldedCoinInfo(createShieldedCoinInfo(toHex(color), price))];
};

/**
 * The coin to cash out, consumed in full. `amount` comes from private state because
 * `redeem` takes only a recipient — the value is whatever coin we hand it.
 */
export const redeemCoin = (
  ctx: Ctx,
): [M402PrivateState, CompactCoin] => {
  const amount = ctx.privateState.pendingRedeem;
  if (amount === undefined) {
    throw new Error('redeemCoin: set pendingRedeem to the amount to cash out before calling redeem().');
  }
  const color = pureCircuits.creditColor({ bytes: fromHex(ctx.contractAddress) });
  return [ctx.privateState, encodeShieldedCoinInfo(createShieldedCoinInfo(toHex(color), amount))];
};

/**
 * Typed against the compiler's own `Witnesses` shape, so changing a witness signature
 * in the contract fails the build here rather than at proving time.
 */
export const witnesses: Witnesses<M402PrivateState> = {
  nonceSeed,
  receiptSecret,
  creditCoin,
  redeemCoin,
};
