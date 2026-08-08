import { describe, expect, it } from 'vitest';
import { formatAtomic } from '@m402/shared';
import { parsePositiveAmount } from '../commands/common.js';

describe('formatAtomic', () => {
  it('formats one atomic unit with its mNIGHT-equivalent', () => {
    expect(formatAtomic(1n)).toBe('1 mSTAR (0.000001 mNIGHT)');
  });

  it('formats a mid-range amount', () => {
    expect(formatAtomic(5_000n)).toBe('5,000 mSTAR (0.005 mNIGHT)');
  });

  it('formats exactly one mNIGHT-equivalent with no trailing fraction', () => {
    expect(formatAtomic(1_000_000n)).toBe('1,000,000 mSTAR (1 mNIGHT)');
  });
});

describe('parsePositiveAmount', () => {
  it('defaults the error unit to STAR, for a deposit amount', () => {
    expect(() => parsePositiveAmount('0', 'Deposit amount')).toThrow(
      'Deposit amount must be a positive integer in STAR.',
    );
  });

  it('reports mSTAR when redeem passes that unit explicitly', () => {
    expect(() => parsePositiveAmount('abc', 'Redeem amount', 'mSTAR')).toThrow(
      'Redeem amount must be a positive integer in mSTAR.',
    );
  });

  it('accepts a valid positive integer regardless of unit', () => {
    expect(parsePositiveAmount('5000', 'Redeem amount', 'mSTAR')).toBe(5000n);
  });
});
