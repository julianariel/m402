import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, it, expect } from 'vitest';
import { createRegistry } from '../src/registry.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('registry', () => {
  it('preserves a description', () => {
    const registry = createRegistry(':memory:');
    registry.insert({
      id: 'svc1',
      price: 100n,
      owner: 'o',
      type: 'origin',
      target: 'https://a',
      description: 'Returns the weather for a city.',
    });
    expect(registry.get('svc1')?.description).toBe('Returns the weather for a city.');
  });

  it('leaves description undefined when omitted', () => {
    const registry = createRegistry(':memory:');
    registry.insert({ id: 'svc1', price: 100n, owner: 'o', type: 'origin', target: 'https://a' });
    expect(registry.get('svc1')?.description).toBeUndefined();
  });

  it('adds the description column to a database created before it existed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm402-registry-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'gateway.db');

    // Simulate a pre-existing gateway.db from before `description` was added: the same
    // CREATE TABLE this module used to run, minus the new column.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE services (
        id     TEXT PRIMARY KEY,
        price  TEXT NOT NULL,
        owner  TEXT NOT NULL,
        type   TEXT NOT NULL,
        target TEXT NOT NULL,
        chain  TEXT
      )
    `);
    legacy.prepare(
      'INSERT INTO services (id, price, owner, type, target, chain) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('legacy-svc', '50', 'o', 'origin', 'https://legacy', null);
    legacy.close();

    const registry = createRegistry(dbPath);
    expect(registry.get('legacy-svc')).toEqual({
      id: 'legacy-svc',
      price: 50n,
      owner: 'o',
      type: 'origin',
      target: 'https://legacy',
      chain: undefined,
      description: undefined,
    });

    // The migration itself must also be idempotent - a second createRegistry against the
    // same (now-migrated) db must not error trying to add the column again.
    expect(() => createRegistry(dbPath)).not.toThrow();
  });
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
