import { randomBytes } from 'node:crypto';
import type { ShieldedCoinInfo } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

/**
 * Private state for an m402 agent.
 *
 * Everything here is unrecoverable if lost. `credits` holds the spendable coins;
 * `receiptSecrets` is what proves a past purchase to an auditor.
 */
export type M402PrivateState = {
  /** Unspent credit coins, most recent first. */
  readonly credits: readonly ShieldedCoinInfo[];
  /** serviceId hex -> the receipt secrets used against it. */
  readonly receiptSecrets: Readonly<Record<string, readonly Uint8Array[]>>;
  /** Set by the caller before `pay`, so `creditCoin` returns the right coin. */
  readonly pendingCoin?: ShieldedCoinInfo;
  /** Set by the caller before `redeem`. */
  readonly pendingRedeem?: ShieldedCoinInfo;
  /** Last values handed to the circuit, so the caller can persist them after. */
  readonly lastNonceSeed?: Uint8Array;
  readonly lastReceiptSecret?: Uint8Array;
};

export const emptyPrivateState = (): M402PrivateState => ({
  credits: [],
  receiptSecrets: {},
});

type Ctx = { privateState: M402PrivateState };

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
 * The coin to spend. `pay` consumes it in full, so this MUST be worth exactly
 * `price` — the wallet splits a larger coin at the Zswap layer beforehand,
 * sending `price` to the vault and the remainder back to itself in the same
 * transaction. Returning a larger coin strands the difference with no error.
 */
export const creditCoin = (
  ctx: Ctx,
  _serviceId: Uint8Array,
  price: bigint,
): [M402PrivateState, ShieldedCoinInfo] => {
  const coin = ctx.privateState.pendingCoin;
  if (!coin) {
    throw new Error(
      'creditCoin: no pendingCoin in private state. Select and split the coin before calling pay().',
    );
  }
  if (coin.value !== price) {
    throw new Error(
      `creditCoin: coin value ${coin.value} != price ${price}. pay() consumes the whole coin — ` +
        'split it to exactly the price first, or the difference is unrecoverable.',
    );
  }
  return [ctx.privateState, coin];
};

/** The coin to cash out. Consumed in full. */
export const redeemCoin = (
  ctx: Ctx,
): [M402PrivateState, ShieldedCoinInfo] => {
  const coin = ctx.privateState.pendingRedeem;
  if (!coin) {
    throw new Error('redeemCoin: no pendingRedeem in private state.');
  }
  return [ctx.privateState, coin];
};

export const witnesses = {
  nonceSeed,
  receiptSecret,
  creditCoin,
  redeemCoin,
};
