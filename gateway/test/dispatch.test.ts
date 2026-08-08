import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { dispatchOrigin } from '../src/dispatch.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('dispatchOrigin', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { url?: string; headers: Record<string, string | string[] | undefined> } | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastRequest = { url: req.url, headers: req.headers };
      if (req.url === '/hang') return; // never responds — exercises the timeout path
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('origin response');
    });
    baseUrl = await listen(server);
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('forwards path suffix and query, returns the origin response verbatim', async () => {
    const service = { id: 'svc1', price: 1n, owner: 'o', type: 'origin' as const, target: `${baseUrl}/api` };
    const req = new Request('http://gateway.local/s/svc1/widgets?limit=5');

    const res = await dispatchOrigin(service, req);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('origin response');
    expect(lastRequest?.url).toBe('/api/widgets?limit=5');
  });

  it('strips X-Payment before forwarding', async () => {
    const service = { id: 'svc1', price: 1n, owner: 'o', type: 'origin' as const, target: baseUrl };
    const req = new Request('http://gateway.local/s/svc1', { headers: { 'X-Payment': 'abc' } });

    await dispatchOrigin(service, req);

    expect(lastRequest?.headers['x-payment']).toBeUndefined();
  });

  it('returns 504 when the origin does not respond in time', async () => {
    const service = { id: 'svc1', price: 1n, owner: 'o', type: 'origin' as const, target: baseUrl };
    const req = new Request('http://gateway.local/s/svc1/hang');

    const res = await dispatchOrigin(service, req, 50);

    expect(res.status).toBe(504);
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

describe('chainFromCaip2', () => {
  it('maps eip155:8453 to base', async () => {
    const { chainFromCaip2 } = await import('../src/dispatch.js');
    expect(chainFromCaip2('eip155:8453').id).toBe(8453);
  });

  it('maps eip155:84532 to baseSepolia', async () => {
    const { chainFromCaip2 } = await import('../src/dispatch.js');
    expect(chainFromCaip2('eip155:84532').id).toBe(84532);
  });

  it('throws for a chain that is not wired up', async () => {
    const { chainFromCaip2 } = await import('../src/dispatch.js');
    expect(() => chainFromCaip2('eip155:1')).toThrow();
  });

  it('throws for a non-eip155 namespace', async () => {
    const { chainFromCaip2 } = await import('../src/dispatch.js');
    expect(() => chainFromCaip2('cosmos:cosmoshub-4')).toThrow();
  });
});

describe('loadRelayerPrivateKey', () => {
  it('reads and validates a 32-byte hex key from disk', async () => {
    const { loadRelayerPrivateKey } = await import('../src/dispatch.js');
    const dir = mkdtempSync(join(tmpdir(), 'm402-'));
    const path = join(dir, 'relayer.key');
    const key = `0x${'11'.repeat(32)}`;
    writeFileSync(path, `${key}\n`);
    expect(loadRelayerPrivateKey(path)).toBe(key);
  });

  it('rejects a malformed key file', async () => {
    const { loadRelayerPrivateKey } = await import('../src/dispatch.js');
    const dir = mkdtempSync(join(tmpdir(), 'm402-'));
    const path = join(dir, 'relayer.key');
    writeFileSync(path, 'not-a-key');
    expect(() => loadRelayerPrivateKey(path)).toThrow();
  });
});

describe('createRelayDispatcher', () => {
  it('does not read the key file until a relay dispatch actually runs', async () => {
    const { createRelayDispatcher } = await import('../src/dispatch.js');
    expect(() => createRelayDispatcher('/nonexistent/relayer.key')).not.toThrow();
  });

  it('strips the Midnight receipt before constructing an external request', async () => {
    const { headersForUpstream } = await import('../src/dispatch.js');
    const headers = headersForUpstream(new Request('http://gateway.local/s/relay', {
      headers: { 'X-Payment': 'midnight-secret', 'X-Correlation': 'keep-me' },
    }));

    expect(headers.get('X-Payment')).toBeNull();
    expect(headers.get('X-Correlation')).toBe('keep-me');
  });
});

describe('createDispatch', () => {
  it('routes to the origin function for type origin', async () => {
    const { createDispatch } = await import('../src/dispatch.js');
    const origin = vi.fn(async () => new Response('origin'));
    const relay = vi.fn(async () => new Response('relay'));
    const dispatch = createDispatch(origin, relay);

    const service = { id: 'x', price: 1n, owner: 'o', type: 'origin' as const, target: 't' };
    await dispatch(service, new Request('http://gateway.local/s/x'));

    expect(origin).toHaveBeenCalledOnce();
    expect(relay).not.toHaveBeenCalled();
  });

  it('routes to the relay function for type relay', async () => {
    const { createDispatch } = await import('../src/dispatch.js');
    const origin = vi.fn(async () => new Response('origin'));
    const relay = vi.fn(async () => new Response('relay'));
    const dispatch = createDispatch(origin, relay);

    const service = { id: 'y', price: 1n, owner: 'o', type: 'relay' as const, target: 't', chain: 'eip155:8453' };
    await dispatch(service, new Request('http://gateway.local/s/y'));

    expect(relay).toHaveBeenCalledOnce();
    expect(origin).not.toHaveBeenCalled();
  });
});
