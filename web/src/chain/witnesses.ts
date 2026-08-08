import {
  createShieldedCoinInfo,
  encodeShieldedCoinInfo,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { pureCircuits } from 'contracts/pure';
import type { Witnesses } from 'contracts/vault-contract';

type CompactCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/**
 * Browser counterpart to contracts/src/witnesses.ts. Same witness semantics — see that file's
 * doc comments for why `nonceSeed`/`receiptSecret` must be fresh CSPRNG output every call, and
 * why `creditCoin` describes an output rather than picking a stored coin. The only difference
 * is randomness: `crypto.getRandomValues` (Web Crypto) instead of node:crypto, since this runs
 * in the wallet-connected tab, not the CLI.
 *
 * Only `pay` is wired from the web app today (see marketplace/), so only `creditCoin` and
 * `receiptSecret` are ever actually invoked — `nonceSeed` and `redeemCoin` back `deposit` and
 * `redeem`, which the web app doesn't call. They're implemented anyway because
 * `CompiledContract.withWitnesses` requires the full `Witnesses<M402PrivateState>` shape.
 */
export type M402PrivateState = {
  readonly pendingReceiptSecret?: Uint8Array;
  readonly pendingRedeem?: bigint;
  readonly lastNonceSeed?: Uint8Array;
  readonly lastReceiptSecret?: Uint8Array;
};

export const emptyPrivateState = (): M402PrivateState => ({});

function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

type Ctx = { privateState: M402PrivateState; contractAddress: string };

const nonceSeed = (ctx: Ctx): [M402PrivateState, Uint8Array] => {
  const seed = randomBytes32();
  return [{ ...ctx.privateState, lastNonceSeed: seed }, seed];
};

/**
 * Reads the secret set by payFor() (chain/circuits.ts) via `pendingReceiptSecret` — set
 * *before* submitting the transaction, so the caller knows the exact secret value up front and
 * can send it in `X-Payment` as soon as the transaction confirms, rather than only recovering
 * it from `nextPrivateState.lastReceiptSecret` after the fact. Mirrors contracts/client.ts's
 * clientWitnesses override.
 */
const receiptSecret = (ctx: Ctx): [M402PrivateState, Uint8Array] => {
  const secret = ctx.privateState.pendingReceiptSecret;
  if (!secret) {
    throw new Error('receiptSecret: prepare and persist a secret before building pay().');
  }
  const { pendingReceiptSecret: _consumed, ...rest } = ctx.privateState;
  return [{ ...rest, lastReceiptSecret: secret }, secret];
};

const creditCoin = (
  ctx: Ctx,
  _serviceId: Uint8Array,
  price: bigint,
): [M402PrivateState, CompactCoin] => {
  const color = pureCircuits.creditColor({ bytes: fromHex(ctx.contractAddress) });
  return [ctx.privateState, encodeShieldedCoinInfo(createShieldedCoinInfo(toHex(color), price))];
};

const redeemCoin = (ctx: Ctx): [M402PrivateState, CompactCoin] => {
  const amount = ctx.privateState.pendingRedeem;
  if (amount === undefined) {
    throw new Error('redeemCoin: set pendingRedeem before calling redeem().');
  }
  const color = pureCircuits.creditColor({ bytes: fromHex(ctx.contractAddress) });
  return [
    { ...ctx.privateState, pendingRedeem: undefined },
    encodeShieldedCoinInfo(createShieldedCoinInfo(toHex(color), amount)),
  ];
};

export const witnesses: Witnesses<M402PrivateState> = {
  nonceSeed,
  receiptSecret,
  creditCoin,
  redeemCoin,
};
