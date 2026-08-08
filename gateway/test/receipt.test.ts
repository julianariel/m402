import { describe, it, expect } from 'vitest';
import { deriveReceipt } from '../src/receipt.js';

function bytes32(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

describe('deriveReceipt', () => {
  it('returns 32 bytes', () => {
    const receipt = deriveReceipt(bytes32(1), bytes32(2));
    expect(receipt).toBeInstanceOf(Uint8Array);
    expect(receipt.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveReceipt(bytes32(1), bytes32(2));
    const b = deriveReceipt(bytes32(1), bytes32(2));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('changes when serviceId changes, for the same secret', () => {
    const a = deriveReceipt(bytes32(1), bytes32(2));
    const b = deriveReceipt(bytes32(1), bytes32(3));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('changes when the secret changes, for the same serviceId', () => {
    const a = deriveReceipt(bytes32(1), bytes32(2));
    const b = deriveReceipt(bytes32(9), bytes32(2));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
