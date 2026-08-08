import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { brotliCompressSync } from 'node:zlib';
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
      if (req.url === '/compressed') {
        const body = brotliCompressSync('compressed response');
        res.writeHead(200, {
          'content-encoding': 'br',
          'content-length': body.length,
          'content-type': 'text/plain',
        });
        res.end(body);
        return;
      }
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

  it('does not forward stale compression headers with a decoded body', async () => {
    const service = { id: 'svc1', price: 1n, owner: 'o', type: 'origin' as const, target: baseUrl };
    const req = new Request('http://gateway.local/s/svc1/compressed');

    const res = await dispatchOrigin(service, req);

    expect(await res.text()).toBe('compressed response');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
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

// One builder serves both dispatchers. Before it existed only the origin path forwarded
// the suffix and query, so a relay service could not accept a parameter at all.
describe('buildUpstreamUrl', () => {
  const build = async (target: string, path: string) => {
    const { buildUpstreamUrl } = await import('../src/dispatch.js');
    return buildUpstreamUrl(target, `http://gw.local${path}`).href;
  };

  it('appends the path suffix after /s/:id', async () => {
    expect(await build('http://origin.test/api/v1', '/s/abc/weather')).toBe('http://origin.test/api/v1/weather');
  });

  it('forwards the caller query string', async () => {
    expect(await build('http://origin.test/api', '/s/abc/x?a=1&b=2')).toBe('http://origin.test/api/x?a=1&b=2');
  });

  it('keeps query params baked into the registered target when the caller sends none', async () => {
    expect(await build('http://origin.test/weather?location=Buenos%20Aires', '/s/abc')).toBe(
      'http://origin.test/weather?location=Buenos+Aires',
    );
  });

  it('lets the caller override a registered default', async () => {
    expect(await build('http://origin.test/weather?location=Buenos%20Aires', '/s/abc?location=Tokyo')).toBe(
      'http://origin.test/weather?location=Tokyo',
    );
  });

  it('keeps a registered default the caller did not mention', async () => {
    const href = await build('http://origin.test/w?units=metric&location=BA', '/s/abc?location=Tokyo');
    expect(href).toContain('units=metric');
    expect(href).toContain('location=Tokyo');
  });

  // Assigning to .pathname cannot change the host — a suffix that looks protocol-relative
  // stays a path segment. This is the property the relayer's funds depend on.
  it('cannot be redirected to another host by the path suffix', async () => {
    expect(await build('http://origin.test/api', '/s/abc//evil.example/x')).toBe(
      'http://origin.test/api//evil.example/x',
    );
  });

  // The WHATWG parser resolves `..` when the Request is constructed, long before this
  // function runs, so a traversal attempt cannot leave the registered path. The containment
  // assert in buildUpstreamUrl is therefore an unreachable invariant guard, not this test's
  // subject — what matters is that the result stays under the target either way.
  it('neutralises a path traversal attempt', async () => {
    // `/s/abc/../../../etc` normalises to `/etc`, which no longer matches the /s/:id
    // prefix, so the whole thing lands under the target as a plain segment.
    expect(await build('http://origin.test/api/v1', '/s/abc/../../../etc')).toBe('http://origin.test/api/v1/etc');
    // `/s/abc/%2e%2e/secret` normalises to `/s/secret`, which the prefix consumes whole —
    // the traversal becomes the service id and leaves no suffix at all. In the running
    // gateway that id resolves to nothing and the request 404s before dispatch.
    expect(await build('http://origin.test/api/v1', '/s/abc/%2e%2e/secret')).toBe('http://origin.test/api/v1');
  });
});

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

// In x402 v2 the spend cap is a policy that filters the offers a server advertises,
// not an argument to the fetch wrapper. If it lets an over-cap offer through, the
// relayer signs it — so this is the guard on every external payment the gateway makes.
describe('maxPaymentPolicy', () => {
  const requirements = (amounts: string[]) => amounts.map((amount) => ({ amount })) as never;

  it('keeps offers at or below the cap and drops the rest', async () => {
    const { maxPaymentPolicy } = await import('../src/dispatch.js');
    const kept = maxPaymentPolicy(10_000n)(2, requirements(['1000', '10000', '10001', '100000']));
    expect(kept.map((r) => (r as { amount: string }).amount)).toEqual(['1000', '10000']);
  });

  it('reads maxAmountRequired from a v1 offer', async () => {
    const { maxPaymentPolicy } = await import('../src/dispatch.js');
    const v1 = [{ maxAmountRequired: '500' }, { maxAmountRequired: '50000' }] as never;
    expect(maxPaymentPolicy(1000n)(1, v1)).toHaveLength(1);
  });

  it('drops an offer with no amount rather than treating it as free', async () => {
    const { maxPaymentPolicy } = await import('../src/dispatch.js');
    expect(maxPaymentPolicy(10_000n)(2, [{}, { amount: 'not-a-number' }] as never)).toHaveLength(0);
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
