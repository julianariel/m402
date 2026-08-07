// Registry row, the 402 body, and the payment header are consumed by six issues
// across three people. Import these, never redeclare them — see ../../docs/stack.md.

export type Service = {
  id: string;   // deriveServiceId(owner, salt) — derived, never freely chosen
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
 * Payment header. The value is the payer's **receipt secret**, hex — NOT the nullifier.
 *
 * The nullifier is written to a public ledger Set. If it were the credential, anyone
 * watching the indexer could see one land and claim the resource before the honest agent
 * retried, then replay it forever. Only `hash("m402:receipt:v1", secret, serviceId)` is
 * published, so holding the secret is what proves the purchase.
 *
 * The gateway must ALSO track consumed secrets locally: the on-chain set proves a payment
 * happened, not that it is still unspent.
 */
export const PAYMENT_HEADER = 'X-Payment';

/** Domain separators. Must match m402Vault.compact exactly. */
export const RECEIPT_DOMAIN = 'm402:receipt:v1';
export const SERVICE_ID_DOMAIN = 'm402:sid:v1';
export const CREDIT_DOMAIN = 'm402:credit:v1';
