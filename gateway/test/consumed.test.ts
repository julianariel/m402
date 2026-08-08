import { describe, it, expect } from 'vitest';
import { createConsumedReceipts } from '../src/consumed.js';

describe('createConsumedReceipts', () => {
  it('reports an unseen receipt as not consumed', () => {
    const store = createConsumedReceipts(':memory:');
    expect(store.isConsumed('abc')).toBe(false);
  });

  it('marks a receipt consumed and reflects it afterwards', () => {
    const store = createConsumedReceipts(':memory:');
    expect(store.markConsumed('abc')).toBe('consumed');
    expect(store.isConsumed('abc')).toBe(true);
  });

  it('reports a second mark of the same receipt as already-consumed', () => {
    const store = createConsumedReceipts(':memory:');
    store.markConsumed('abc');
    expect(store.markConsumed('abc')).toBe('already-consumed');
  });

  it('keeps distinct receipts independent', () => {
    const store = createConsumedReceipts(':memory:');
    store.markConsumed('abc');
    expect(store.isConsumed('def')).toBe(false);
  });
});
