import { pureCircuits } from 'contracts/pure';

export type DeriveReceipt = (secret: Uint8Array, serviceId: Uint8Array) => Uint8Array;

// Exported pure circuit — no proof required, and the hash construction
// (domain separator, padding, Vector<3, Bytes<32>> layout) lives once in the
// contract instead of being reimplemented here. See the #6 comment thread.
export const deriveReceipt: DeriveReceipt = (secret, serviceId) =>
  pureCircuits.deriveReceipt(secret, serviceId);
