import { describe, expect, it } from 'vitest';
import { assertExpectedPrice } from 'contracts/client';

describe('contract client safeguards', () => {
  it('refuses a gateway quote that differs from the registered on-chain price', () => {
    expect(() => assertExpectedPrice(1n, 500n)).toThrow(
      'Gateway price 1 does not match on-chain price 500',
    );
    expect(() => assertExpectedPrice(500n, 500n)).not.toThrow();
  });
});
