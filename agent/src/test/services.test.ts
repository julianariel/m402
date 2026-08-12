import { describe, expect, it } from 'vitest';
import { assertExpectedPrice } from 'contracts/inspect-vault';
import { buildServiceRows, parseServiceType } from '../commands/services.js';

const GATEWAY_URL = 'https://gw.example';

describe('buildServiceRows', () => {
  it('marks a service verified when the gateway price matches the chain', () => {
    const rows = buildServiceRows(
      [{ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://a' }],
      [{ id: 'svc1', price: 500n }],
      GATEWAY_URL,
      assertExpectedPrice,
    );
    expect(rows).toEqual([
      {
        id: 'svc1',
        price: '500',
        type: 'origin',
        target: 'https://a',
        chain: undefined,
        description: undefined,
        callUrl: `${GATEWAY_URL}/s/svc1`,
        priceVerified: true,
        priceWarning: undefined,
      },
    ]);
  });

  it('flags a price mismatch between the gateway and the chain', () => {
    const rows = buildServiceRows(
      [{ id: 'svc1', price: 1n, owner: 'o', type: 'origin', target: 'https://a' }],
      [{ id: 'svc1', price: 500n }],
      GATEWAY_URL,
      assertExpectedPrice,
    );
    expect(rows[0]?.priceVerified).toBe(false);
    expect(rows[0]?.priceWarning).toContain('does not match on-chain price');
  });

  it('flags a service the gateway lists but the chain has never registered', () => {
    const rows = buildServiceRows(
      [{ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://a' }],
      [],
      GATEWAY_URL,
      assertExpectedPrice,
    );
    expect(rows[0]?.priceVerified).toBe(false);
    expect(rows[0]?.priceWarning).toContain('Not found on-chain');
  });

  it('carries the description through untouched', () => {
    const rows = buildServiceRows(
      [{ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://a', description: 'weather' }],
      [{ id: 'svc1', price: 500n }],
      GATEWAY_URL,
      assertExpectedPrice,
    );
    expect(rows[0]?.description).toBe('weather');
  });

  it('builds a ready-to-run call URL per row', () => {
    const rows = buildServiceRows(
      [{ id: 'abc123', price: 500n, owner: 'o', type: 'origin', target: 'https://a' }],
      [{ id: 'abc123', price: 500n }],
      GATEWAY_URL,
      assertExpectedPrice,
    );
    expect(rows[0]?.callUrl).toBe(`${GATEWAY_URL}/s/abc123`);
  });

  it('filters by type when requested', () => {
    const rows = buildServiceRows(
      [
        { id: 'a', price: 1n, owner: 'o', type: 'origin', target: 'https://a' },
        { id: 'b', price: 1n, owner: 'o', type: 'relay', target: 'https://b', chain: 'eip155:84532' },
      ],
      [
        { id: 'a', price: 1n },
        { id: 'b', price: 1n },
      ],
      GATEWAY_URL,
      assertExpectedPrice,
      { type: 'relay' },
    );
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });
});

describe('parseServiceType', () => {
  it('passes through undefined', () => {
    expect(parseServiceType(undefined)).toBeUndefined();
  });

  it('accepts origin and relay', () => {
    expect(parseServiceType('origin')).toBe('origin');
    expect(parseServiceType('relay')).toBe('relay');
  });

  it('rejects anything else', () => {
    expect(() => parseServiceType('bogus')).toThrow("Unknown service type 'bogus'");
  });
});
