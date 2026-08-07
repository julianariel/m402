// Registry row, the 402 body, and the payment header are consumed by six issues
// across three people. Import these, never redeclare them — see ../../docs/stack.md.

export type Service = {
  id: string;
  price: bigint;
  owner: string;
  type: 'origin' | 'relay';
  target: string; // origin: proxy here · relay: pay-and-fetch here
  chain?: string; // CAIP-2, relay only, e.g. 'eip155:8453'
};

export type PaymentRequired = {
  serviceId: string;
  price: string;
  vaultAddress: string;
};

export const PAYMENT_HEADER = 'X-Payment'; // value: nullifier hex
