// Registry row, the 402 body, and the payment header are consumed by six issues
// across three people. Import these, never redeclare them — see ../../docs/stack.md.

export type Service = {
  // deriveServiceId(owner, salt, price) — derived, never freely chosen. `price` is part
  // of the derivation: change it and the id changes, so a registration cannot be
  // front-run at a different price. Use the exported pure circuit, never a local hash.
  id: string;
  price: bigint;
  owner: string; // merchant's unshielded Lace address bytes, hex
  type: 'origin' | 'relay';
  target: string; // origin: proxy here · relay: pay-and-fetch here
  chain?: string; // CAIP-2, relay only, e.g. 'eip155:8453'
};

export type PaymentRequired = {
  serviceId: string;
  price: string;
  vaultAddress: string;
};

/**
 * Payment header. The value is the payer's **receipt secret**, hex — never the hash.
 *
 * The receipt HASH is written to the public `receipts` ledger Set. If the hash were the
 * credential, anyone watching the indexer could see one land and claim the resource before
 * the honest agent retried, then replay it forever. Only
 * `deriveReceipt(secret, serviceId)` is published, so holding the secret is what proves the
 * purchase.
 *
 * The contract has **no nullifier**. Zswap already prevents spending a coin twice, so the
 * earlier nullifier set guarded nothing and was removed. Do not reintroduce the term here.
 *
 * The gateway must ALSO track consumed secrets locally: the on-chain set proves a payment
 * happened, not that it is still unspent.
 */
export const PAYMENT_HEADER = 'X-Payment';

/** Domain separators. Must match m402Vault.compact exactly. */
export const RECEIPT_DOMAIN = 'm402:receipt:v1';
export const SERVICE_ID_DOMAIN = 'm402:sid:v1';
export const CREDIT_DOMAIN = 'm402:credit:v1';

/**
 * Fixed USD → STAR conversion rate, applied once at registration (design.md §4).
 * One source of truth so the publish form, the explorer, and the CLI never each
 * hardcode their own copy of this number.
 */
export const USD_TO_STAR_RATE = 50_000;

/** STAR is what goes on-chain; the USD figure is display-only and drifts. */
export function usdToStar(usd: number): bigint {
  return BigInt(Math.round(usd * USD_TO_STAR_RATE));
}
