import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/registry.js';

describe('registry', () => {
  it('returns undefined for an unknown id', () => {
    const registry = createRegistry(':memory:');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('inserts and reads back a service, preserving bigint price', () => {
    const registry = createRegistry(':memory:');
    const result = registry.insert({
      id: 'svc1',
      price: 500n,
      owner: '0xowner',
      type: 'origin',
      target: 'https://example.com/api',
    });
    expect(result).toBe('created');

    expect(registry.get('svc1')).toEqual({
      id: 'svc1',
      price: 500n,
      owner: '0xowner',
      type: 'origin',
      target: 'https://example.com/api',
      chain: undefined,
    });
  });

  it('preserves chain for a relay service', () => {
    const registry = createRegistry(':memory:');
    registry.insert({
      id: 'svc2',
      price: 100n,
      owner: '0xowner',
      type: 'relay',
      target: 'https://relay.example.com',
      chain: 'eip155:8453',
    });
    expect(registry.get('svc2')?.chain).toBe('eip155:8453');
  });

  it('rejects a duplicate id', () => {
    const registry = createRegistry(':memory:');
    registry.insert({ id: 'svc1', price: 100n, owner: 'a', type: 'origin', target: 'https://a' });
    const result = registry.insert({ id: 'svc1', price: 200n, owner: 'b', type: 'origin', target: 'https://b' });
    expect(result).toBe('conflict');
    expect(registry.get('svc1')?.owner).toBe('a'); // original row untouched
  });

  it('lists all inserted services', () => {
    const registry = createRegistry(':memory:');
    registry.insert({ id: 'a', price: 1n, owner: 'o', type: 'origin', target: 'https://a' });
    registry.insert({ id: 'b', price: 2n, owner: 'o', type: 'relay', target: 'https://b', chain: 'eip155:8453' });
    expect(registry.list()).toHaveLength(2);
  });
});
