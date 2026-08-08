import { describe, it, expect } from 'vitest';
import { createRoutes, type RouteDeps } from '../src/routes.js';
import { createRegistry } from '../src/registry.js';

function testApp(overrides: Partial<RouteDeps> = {}) {
  const registry = createRegistry(':memory:');
  const app = createRoutes({
    registry,
    verify: async () => 'timeout',
    dispatch: async () => new Response('dispatched'),
    probeOrigin: async () => true,
    checkOwnership: async () => 'match',
    vaultAddress: 'vault-address',
    verifyTimeoutMs: 1000,
    ...overrides,
  });
  return { app, registry };
}

describe('GET /s/:id', () => {
  it('returns 404 for an unknown service', async () => {
    const { app } = testApp();
    const res = await app.request('/s/missing');
    expect(res.status).toBe(404);
  });

  it('returns 402 with the payment body when unpaid', async () => {
    const { app, registry } = testApp();
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1');
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ serviceId: 'svc1', price: '500', vaultAddress: 'vault-address' });
  });

  it('returns 503 { reason: origin-down } when the health probe fails', async () => {
    const { app, registry } = testApp({ probeOrigin: async () => false });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reason: 'origin-down' });
  });

  it('does not health-check relay services', async () => {
    const { app, registry } = testApp({
      probeOrigin: async () => { throw new Error('must not be called for relay services'); },
    });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'relay', target: 'https://x402.example', chain: 'eip155:8453' });
    const res = await app.request('/s/svc1');
    expect(res.status).toBe(402);
  });

  it('dispatches and forwards path suffix + query when verification confirms', async () => {
    const { app, registry } = testApp({ verify: async () => 'confirmed' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1/widgets?limit=5', { headers: { 'X-Payment': 'receipt-secret-hex' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('dispatched');
  });

  it('forwards a POST body to dispatch after verification', async () => {
    const { app, registry } = testApp({ verify: async () => 'confirmed' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', {
      method: 'POST',
      headers: { 'X-Payment': 'receipt-secret-hex', 'content-type': 'application/json' },
      body: JSON.stringify({ q: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 402 { reason: receipt-already-used } when the receipt was already redeemed', async () => {
    const { app, registry } = testApp({ verify: async () => 'replayed' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', { headers: { 'X-Payment': 'receipt-secret-hex' } });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ reason: 'receipt-already-used' });
  });

  it('returns 402 with the payment body again when the secret paid a different service', async () => {
    const { app, registry } = testApp({ verify: async () => 'wrong-service' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', { headers: { 'X-Payment': 'receipt-secret-hex' } });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ serviceId: 'svc1', price: '500', vaultAddress: 'vault-address' });
  });

  it('returns 503 payment-pending with Retry-After on verification timeout', async () => {
    const { app, registry } = testApp({ verify: async () => 'timeout' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', { headers: { 'X-Payment': 'receipt-secret-hex' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ reason: 'payment-pending' });
  });
});

describe('GET /services', () => {
  it('lists services with price serialized as a string', async () => {
    const { app, registry } = testApp();
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/services');
    expect(await res.json()).toEqual([
      { id: 'svc1', price: '500', owner: 'o', type: 'origin', target: 'https://example.com', chain: undefined },
    ]);
  });
});

describe('POST /services', () => {
  it('creates a new service and returns 201', async () => {
    const { app, registry } = testApp();
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'svc1', price: '500', owner: 'o', type: 'origin', target: 'https://example.com' }),
    });
    expect(res.status).toBe(201);
    expect(registry.get('svc1')).toBeDefined();
  });

  it('rejects a relay service missing chain with 400', async () => {
    const { app } = testApp();
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'svc1', price: '500', owner: 'o', type: 'relay', target: 'https://example.com' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = testApp();
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate id with 409', async () => {
    const { app, registry } = testApp();
    registry.insert({ id: 'svc1', price: 1n, owner: 'o', type: 'origin', target: 'https://a' });
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'svc1', price: '2', owner: 'p', type: 'origin', target: 'https://b' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 503 when the on-chain registration is not yet confirmed', async () => {
    const { app, registry } = testApp({ checkOwnership: async () => 'unconfirmed' });
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'svc1', price: '500', owner: 'o', type: 'origin', target: 'https://example.com' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reason: 'registration-not-yet-confirmed' });
    expect(registry.get('svc1')).toBeUndefined();
  });

  it('returns 403 when the claimed owner does not match the on-chain owner', async () => {
    const { app, registry } = testApp({ checkOwnership: async () => 'mismatch' });
    const res = await app.request('/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'svc1', price: '500', owner: 'attacker', type: 'origin', target: 'https://example.com' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ reason: 'owner-mismatch' });
    expect(registry.get('svc1')).toBeUndefined();
  });
});
