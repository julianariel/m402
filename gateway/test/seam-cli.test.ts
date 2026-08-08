/**
 * Seam tests: the REAL gateway routes driven by the REAL agent CLI HTTP client.
 *
 * Every workspace already tests itself against its own mocks, and both suites are green.
 * That proves each side is self-consistent, not that they agree with each other. The CLI's
 * `mock-gateway.ts` is a hand-written imitation of the gateway; when the gateway changes,
 * nothing forces the imitation to follow. These tests remove the imitation from the loop:
 * `createRoutes` is served over a real socket and `requestResource` / `claimResource` are
 * pointed at it, so the only thing under test is whether the two halves speak the same
 * protocol.
 *
 * Deliberately excluded: proving, the chain, the indexer and SQLite. `verify` and the
 * registry are stubbed so a run costs milliseconds. What the chain does is covered by
 * contracts/src/test/deploy.test.ts; what these cover is the HTTP contract between the two
 * codebases, which is where a self-consistent mock hides a real defect.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { PAYMENT_HEADER, type Service } from '@m402/shared';

import { createRoutes, type VerifyResult } from '../src/routes.js';
import type { Registry } from '../src/registry.js';
import { requestResource, claimResource } from '../../agent/src/http.js';

const VAULT = 'a'.repeat(64);
const SERVICE_ID = 'b'.repeat(64);
const SECRET = 'c'.repeat(64);
const PRICE = 500n;

const SERVICE: Service = {
  id: SERVICE_ID,
  price: PRICE,
  owner: 'd'.repeat(64),
  type: 'origin',
  target: 'https://origin.invalid/resource',
};

/** In-memory stand-in for the SQLite registry; storage is not what these tests are about. */
function fakeRegistry(rows: Service[] = [SERVICE]): Registry {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    insert: (row) => (byId.has(row.id) ? 'conflict' : (byId.set(row.id, row), 'created')),
  };
}

type Harness = { url: string; close: () => Promise<void> };

const running: Harness[] = [];

async function startGateway(overrides: {
  verify?: (secret: string, serviceId: string, timeoutMs: number) => Promise<VerifyResult>;
  registry?: Registry;
  probeOrigin?: (target: string) => Promise<boolean>;
  dispatch?: (service: Service, req: Request) => Promise<Response>;
} = {}): Promise<Harness> {
  const app = createRoutes({
    registry: overrides.registry ?? fakeRegistry(),
    vaultAddress: VAULT,
    verifyTimeoutMs: 50,
    verify: overrides.verify ?? (async () => 'confirmed'),
    probeOrigin: overrides.probeOrigin ?? (async () => true),
    checkOwnership: async () => 'match',
    relayTargetAllowlist: new Set<string>(),
    dispatch:
      overrides.dispatch ??
      (async () => new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
  });

  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const harness: Harness = {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  running.push(harness);
  return harness;
}

afterEach(async () => {
  while (running.length) await running.pop()!.close();
});

describe('gateway ↔ CLI seam', () => {
  it('the CLI can parse the 402 the gateway actually sends', async () => {
    // The CLI validates far more strictly than the gateway's own tests assert: serviceId
    // and vaultAddress must be 64-char hex, and price a positive integer STRING. A gateway
    // that emitted a number for price, or a 0x-prefixed id, would pass its own suite and
    // fail here.
    const gw = await startGateway();

    const result = await requestResource(`${gw.url}/s/${SERVICE_ID}`);

    expect(result.kind).toBe('payment-required');
    if (result.kind !== 'payment-required') return;
    expect(result.requirements.serviceId).toBe(SERVICE_ID);
    expect(result.requirements.price).toBe(PRICE.toString());
    expect(result.requirements.vaultAddress).toBe(VAULT);
  });

  it('sends the receipt secret in the header the gateway reads, and gets the resource', async () => {
    const seen: string[] = [];
    const gw = await startGateway({
      verify: async (secret) => {
        seen.push(secret);
        return 'confirmed';
      },
    });

    const claimed = await claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET);

    expect(claimed.response.status).toBe(200);
    await expect(claimed.response.json()).resolves.toEqual({ value: 42 });
    // The header name is agreed in @m402/shared; this proves both sides use it.
    expect(seen).toEqual([SECRET]);
  });

  it('surfaces a 404 for an unknown service rather than treating it as payment required', async () => {
    const gw = await startGateway({ registry: fakeRegistry([]) });

    await expect(requestResource(`${gw.url}/s/${'e'.repeat(64)}`)).rejects.toThrow(/404/);
  });

  it('does not resend the receipt secret across a redirect', async () => {
    // X-Payment is a bearer credential. `claimResource` sets redirect: 'manual' so a
    // gateway (or anything impersonating one) cannot bounce the secret to another host.
    const gw = await startGateway({
      dispatch: async () =>
        new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }),
    });

    // A manual redirect is not `ok`, so the CLI reports it rather than following it.
    await expect(claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET)).rejects.toThrow(/302/);
  });

  it('retries while the gateway reports the payment is still pending', async () => {
    // THE case this whole file exists for, and the regression guard for #23.
    //
    // When a payment has landed but the gateway has not yet observed its receipt, the
    // gateway answers `503 {reason: 'payment-pending'}` with a Retry-After header — it is
    // explicitly asking the caller to come back.
    //
    // Before #23 the CLI retried only on 402 and treated every other non-ok status as
    // fatal, so it gave up on the first pending response. Both suites stayed green because
    // mock-gateway.ts modelled this case as a 402 too.
    let calls = 0;
    const gw = await startGateway({
      verify: async () => {
        calls++;
        return calls < 3 ? 'timeout' : 'confirmed';
      },
    });

    const claimed = await claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET, {
      retryDelaysMs: [1, 1, 1, 1],
      sleep: async () => {},
    });

    expect(claimed.response.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('gives up promptly on a replayed receipt instead of retrying it', async () => {
    // The mirror image of the test above. `receipt-already-used` is permanent — no amount
    // of retrying makes a spent secret valid again. The gateway returns it as a 402, and
    // before #23 that was the CLI's signal to RETRY, so a replay cost the full backoff
    // window and then reported "the gateway has not observed its receipt", which is not
    // what happened. A 402 answering a request that carried a secret is now terminal.
    let calls = 0;
    const gw = await startGateway({
      verify: async () => {
        calls++;
        return 'replayed';
      },
    });

    await expect(
      claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET, {
        retryDelaysMs: [1, 1],
        sleep: async () => {},
      }),
    ).rejects.toThrow(/already been used/i);

    expect(calls).toBe(1);
  });

  it('does not retry a 503 that came from the origin rather than from verification', async () => {
    // The retry rule matches on the REASON, not on the status. `dispatch` proxies the
    // origin's own response, so a broken origin also arrives as a 503 — but the agent has
    // already paid and the resource is not coming, so retrying only hammers it. Matching
    // on 503 alone would turn one dead origin into six requests to it.
    let dispatched = 0;
    const gw = await startGateway({
      dispatch: async () => {
        dispatched++;
        return new Response(JSON.stringify({ error: 'origin exploded' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await expect(
      claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET, {
        retryDelaysMs: [1, 1, 1],
        sleep: async () => {},
      }),
    ).rejects.toThrow(/503/);

    expect(dispatched).toBe(1);
  });

  it("waits the gateway's Retry-After instead of its own ladder", async () => {
    // The gateway sends `Retry-After: 5`. It knows more about its own indexer lag than a
    // fixed client-side ladder does, so its estimate wins when it offers one.
    let calls = 0;
    const slept: number[] = [];
    const gw = await startGateway({
      verify: async () => (++calls < 2 ? 'timeout' : 'confirmed'),
    });

    await claimResource(`${gw.url}/s/${SERVICE_ID}`, SECRET, {
      retryDelaysMs: [999_999],
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    // 5s from the header, not the 999999 ladder entry.
    expect(slept).toEqual([5_000]);
  });

  it('serves the service list in the shape the explorer needs', async () => {
    // web/ currently renders a hardcoded fixture instead of calling this. When it is wired
    // up, this is the contract it depends on — notably `price` as a decimal STRING, since
    // a bigint cannot survive JSON.
    const gw = await startGateway();

    const response = await fetch(`${gw.url}/services`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: SERVICE_ID,
      price: PRICE.toString(),
      type: 'origin',
      target: SERVICE.target,
    });
    expect(typeof body[0]!['price']).toBe('string');
  });
});

describe('CLI mock-gateway fidelity', () => {
  it('models the pending-payment case the same way the real gateway does', async () => {
    // A fixture that has drifted from the thing it imitates is worse than no fixture: it
    // turns a real defect into a green suite. This test fails whenever the two disagree.
    const gw = await startGateway({ verify: async () => 'timeout' });

    const real = await fetch(`${gw.url}/s/${SERVICE_ID}`, {
      headers: { [PAYMENT_HEADER]: SECRET },
    });

    const { startMockGateway } = await import('../../agent/src/test/mock-gateway.js');
    const mock = await startMockGateway({
      requirements: { serviceId: SERVICE_ID, price: PRICE.toString(), vaultAddress: VAULT },
      receiptSecret: SECRET,
      laggedClaims: 1,
    });

    try {
      const imitation = await fetch(`${mock.url}/s/test`, {
        headers: { [PAYMENT_HEADER]: SECRET },
      });
      expect(imitation.status).toBe(real.status);
    } finally {
      await mock.close();
    }
  });
});
