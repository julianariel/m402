# Gateway Implementation Plan

> **Superseded — implementation complete, but diverged from this plan.** All six tasks were
> built, then reworked once the contract moved from a nullifier-based to a receipt-secret
> model mid-implementation (no `nullifiers` set; `X-Payment` carries a secret, not the
> nullifier directly; `verify.ts`'s `Verify`/`SubscribeFn` types below are stale). Two
> pieces were added beyond this plan's scope: a local consumed-receipts replay guard
> (`gateway/src/consumed.ts`) and an on-chain registration-ownership check for
> `POST /services` (`gateway/src/ownership.ts`). The indexer subscription also moved from a
> hand-rolled `graphql-ws` query (marked UNCONFIRMED throughout this plan) to the Midnight
> SDK's `PublicDataProvider.contractStateObservable`. For what's actually running, see
> [`../../../gateway/README.md`](../../../gateway/README.md). Kept here for
> planning-history context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gateway service end to end — registry, 402/verify/dispatch routing, origin proxy, EVM relay, and pre-402 health check — covering issues #6, #7, #8, #12, #17.

**Architecture:** A Hono app (`routes.ts`) as the only file that touches HTTP. Everything else — `registry.ts`, `verify.ts`, `dispatch.ts`, `health.ts` — is plain, dependency-injected functions with no Hono types, callable and testable in isolation. `config.ts` reads env once. `index.ts` wires the real implementations together and starts the server.

**Tech Stack:** Hono, `@hono/node-server`, `better-sqlite3`, `graphql-ws` + `ws`, `viem`, `x402-fetch`, Vitest, Node's native `fetch`/`http`.

## Global Constraints

- **Node 22 or 24 only** — repo pins `22.x || 24.x` in `package.json` engines and `.nvmrc` (`22.12.0`). Not 23, not 26.
- **TypeScript strict, ESM, `NodeNext` module resolution** — relative imports must include the `.js` extension (e.g. `import { x } from './registry.js'`) even though the source file is `.ts`.
- **Never redeclare `Service`, `PaymentRequired`, or `PAYMENT_HEADER`** — always `import ... from '@m402/shared'`. Per `stack.md`: "A second definition of `Service` is a merge conflict at hour 20, in the code path that carries the money."
- **`Service.price` is `bigint`; every wire format (JSON bodies) uses `string`.** Convert at the boundary — `.toString()` out, `BigInt(...)` in.
- **The gateway is a single long-lived process** — it holds a live indexer subscription, so nothing here should assume serverless/stateless restarts (`stack.md`).
- **Registry writes are first-write-wins.** A `POST /services` for an existing `serviceId` is rejected with 409 — mirrors the on-chain `registerService` immutability guard.
- **Indexer subscriptions replay from genesis; a short listen window is indistinguishable from "no activity."** `watchForNullifier`'s timeout defaults to 60s, and a timeout must never be treated as proof of non-payment (`constraints.md`).
- **`API-WS ... 1006 Abnormal Closure` during indexer sync is noise, not failure** — do not build retry/backoff logic keyed on it; reconnect and keep waiting (#7).
- **Secret material (the relayer's private key) is read from a gitignored file on disk — never from argv, never from an environment variable holding the secret value itself.** An env var may hold a *path* to that file. Both argv and env-var-as-secret leak through `ps` (`stack.md`, Security section).
- **The gateway holds no funds and signs nothing** — it only reads the chain. The one documented exception is the relayer, which is an explicitly trusted operator fronting USDC (#12) — call this out in code comments where the relayer signs, so the exception doesn't read as a violation of the rule.

---

## Task 1: Registry — SQLite-backed service storage

**Files:**
- Create: `gateway/src/registry.ts`
- Test: `gateway/test/registry.test.ts`

**Interfaces:**
- Consumes: `Service` from `@m402/shared`
- Produces:
  ```ts
  export type Registry = {
    get(id: string): Service | undefined;
    list(): Service[];
    insert(row: Service): 'created' | 'conflict';
  };
  export function createRegistry(dbPath: string): Registry;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// gateway/test/registry.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- registry.test.ts`
Expected: FAIL — `Cannot find module '../src/registry.js'`

- [ ] **Step 3: Add the dependency and write the implementation**

`better-sqlite3` is already a gateway dependency (`gateway/package.json`), so no install is needed for this task.

```ts
// gateway/src/registry.ts
import Database from 'better-sqlite3';
import type { Service } from '@m402/shared';

export type Registry = {
  get(id: string): Service | undefined;
  list(): Service[];
  insert(row: Service): 'created' | 'conflict';
};

type ServiceRow = {
  id: string;
  price: string;
  owner: string;
  type: 'origin' | 'relay';
  target: string;
  chain: string | null;
};

function rowToService(row: ServiceRow): Service {
  return {
    id: row.id,
    price: BigInt(row.price),
    owner: row.owner,
    type: row.type,
    target: row.target,
    chain: row.chain ?? undefined,
  };
}

export function createRegistry(dbPath: string): Registry {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id     TEXT PRIMARY KEY,
      price  TEXT NOT NULL,
      owner  TEXT NOT NULL,
      type   TEXT NOT NULL,
      target TEXT NOT NULL,
      chain  TEXT
    )
  `);

  const getStmt = db.prepare<[string], ServiceRow>('SELECT * FROM services WHERE id = ?');
  const listStmt = db.prepare<[], ServiceRow>('SELECT * FROM services');
  const insertStmt = db.prepare(
    'INSERT INTO services (id, price, owner, type, target, chain) VALUES (@id, @price, @owner, @type, @target, @chain)'
  );

  return {
    get(id) {
      const row = getStmt.get(id);
      return row ? rowToService(row) : undefined;
    },
    list() {
      return listStmt.all().map(rowToService);
    },
    insert(service) {
      try {
        insertStmt.run({
          id: service.id,
          price: service.price.toString(),
          owner: service.owner,
          type: service.type,
          target: service.target,
          chain: service.chain ?? null,
        });
        return 'created';
      } catch (err) {
        if (err instanceof Error && 'code' in err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
          return 'conflict';
        }
        throw err;
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w gateway -- registry.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w gateway`

```bash
git add gateway/src/registry.ts gateway/test/registry.test.ts
git commit -m "Add SQLite-backed service registry"
```

---

## Task 2: Config, routes skeleton, and server wiring (#6)

**Files:**
- Create: `gateway/src/config.ts`
- Create: `gateway/src/routes.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/test/routes.test.ts`

**Interfaces:**
- Consumes: `Registry` (Task 1), `Service`, `PaymentRequired`, `PAYMENT_HEADER` from `@m402/shared`
- Produces:
  ```ts
  export type VerifyResult = 'confirmed' | 'wrong-service' | 'timeout';
  export type Verify = (nullifier: string, serviceId: string, timeoutMs: number) => Promise<VerifyResult>;
  export type Dispatch = (service: Service, req: Request) => Promise<Response>;
  export type ProbeOrigin = (target: string) => Promise<boolean>;

  export type RouteDeps = {
    registry: Registry;
    verify: Verify;
    dispatch: Dispatch;
    probeOrigin: ProbeOrigin;
    vaultAddress: string;
    verifyTimeoutMs: number;
  };
  export function createRoutes(deps: RouteDeps): Hono;
  ```
  These four types (`VerifyResult`, `Verify`, `Dispatch`, `ProbeOrigin`) are the contracts Tasks 3–6 implement against.

**Routing note:** the handler is mounted at both `/s/:id` and `/s/:id/*`, and for every HTTP method (`app.all`), not just `GET` — #8 needs to forward arbitrary path suffixes, query strings, and methods (POST/PUT/etc.) to the origin. The suffix is recovered from the raw request URL inside `dispatch.ts` in Task 4, not from Hono's route params.

- [ ] **Step 1: Write the failing tests**

```ts
// gateway/test/routes.test.ts
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
    const res = await app.request('/s/svc1/widgets?limit=5', { headers: { 'X-Payment': 'nullifier-hex' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('dispatched');
  });

  it('forwards a POST body to dispatch after verification', async () => {
    const { app, registry } = testApp({ verify: async () => 'confirmed' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', {
      method: 'POST',
      headers: { 'X-Payment': 'nullifier-hex', 'content-type': 'application/json' },
      body: JSON.stringify({ q: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 402 again when the nullifier belongs to a different service', async () => {
    const { app, registry } = testApp({ verify: async () => 'wrong-service' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', { headers: { 'X-Payment': 'nullifier-hex' } });
    expect(res.status).toBe(402);
  });

  it('returns 503 payment-pending with Retry-After on verification timeout', async () => {
    const { app, registry } = testApp({ verify: async () => 'timeout' });
    registry.insert({ id: 'svc1', price: 500n, owner: 'o', type: 'origin', target: 'https://example.com' });
    const res = await app.request('/s/svc1', { headers: { 'X-Payment': 'nullifier-hex' } });
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- routes.test.ts`
Expected: FAIL — `Cannot find module '../src/routes.js'`

- [ ] **Step 3: Write `config.ts`**

```ts
// gateway/src/config.ts
export const config = {
  port: Number(process.env.PORT ?? 8787),
  vaultAddress: process.env.VAULT_ADDRESS ?? '',
  dbPath: process.env.DB_PATH ?? 'gateway.db',
  indexerWsUrl: process.env.INDEXER_WS_URL ?? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  relayerKeyFile: process.env.RELAYER_KEY_FILE ?? './relayer.key',
  verifyTimeoutMs: 60_000,
};
```

- [ ] **Step 4: Write `routes.ts`**

```ts
// gateway/src/routes.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import { PAYMENT_HEADER, type Service, type PaymentRequired } from '@m402/shared';
import type { Registry } from './registry.js';

export type VerifyResult = 'confirmed' | 'wrong-service' | 'timeout';
export type Verify = (nullifier: string, serviceId: string, timeoutMs: number) => Promise<VerifyResult>;
export type Dispatch = (service: Service, req: Request) => Promise<Response>;
export type ProbeOrigin = (target: string) => Promise<boolean>;

export type RouteDeps = {
  registry: Registry;
  verify: Verify;
  dispatch: Dispatch;
  probeOrigin: ProbeOrigin;
  vaultAddress: string;
  verifyTimeoutMs: number;
};

function paymentRequiredBody(service: Service, vaultAddress: string): PaymentRequired {
  return { serviceId: service.id, price: service.price.toString(), vaultAddress };
}

export function createRoutes(deps: RouteDeps): Hono {
  const app = new Hono();

  const handleService = async (c: Context) => {
    const service = deps.registry.get(c.req.param('id'));
    if (!service) return c.body(null, 404);

    const nullifier = c.req.header(PAYMENT_HEADER);

    if (!nullifier) {
      if (service.type === 'origin') {
        const healthy = await deps.probeOrigin(service.target);
        if (!healthy) return c.json({ reason: 'origin-down' }, 503);
      }
      return c.json(paymentRequiredBody(service, deps.vaultAddress), 402);
    }

    const result = await deps.verify(nullifier, service.id, deps.verifyTimeoutMs);

    if (result === 'timeout') {
      c.header('Retry-After', '5');
      return c.json({ reason: 'payment-pending' }, 503);
    }
    if (result === 'wrong-service') {
      return c.json(paymentRequiredBody(service, deps.vaultAddress), 402);
    }

    return deps.dispatch(service, c.req.raw);
  };

  app.all('/s/:id', handleService);
  app.all('/s/:id/*', handleService);

  app.get('/services', (c) => {
    const body = deps.registry.list().map((s) => ({ ...s, price: s.price.toString() }));
    return c.json(body);
  });

  app.post('/services', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validType = body && (body.type === 'origin' || body.type === 'relay');
    const valid =
      body &&
      typeof body.id === 'string' &&
      typeof body.price === 'string' &&
      typeof body.owner === 'string' &&
      validType &&
      typeof body.target === 'string' &&
      (body.type !== 'relay' || typeof body.chain === 'string');

    if (!valid) return c.body(null, 400);

    const service: Service = {
      id: body.id,
      price: BigInt(body.price),
      owner: body.owner,
      type: body.type,
      target: body.target,
      chain: body.chain,
    };

    const result = deps.registry.insert(service);
    return c.body(null, result === 'conflict' ? 409 : 201);
  });

  return app;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w gateway -- routes.test.ts`
Expected: PASS, 13 tests

- [ ] **Step 6: Wire it into `index.ts`**

```ts
// gateway/src/index.ts
import { serve } from '@hono/node-server';
import { createRoutes } from './routes.js';
import { createRegistry } from './registry.js';
import { config } from './config.js';

const registry = createRegistry(config.dbPath);

const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify: async () => 'timeout', // replaced in Task 3 (#7)
  probeOrigin: async () => true, // replaced in Task 6 (#17)
  dispatch: async () => new Response(null, { status: 501 }), // replaced in Tasks 4-5 (#8, #12)
});

app.get('/healthz', (c) => c.text('ok'));

serve({ fetch: app.fetch, port: config.port });
```

- [ ] **Step 7: Typecheck, run the full gateway test suite, and commit**

```bash
npm run typecheck -w gateway
npm test -w gateway
git add gateway/src/config.ts gateway/src/routes.ts gateway/src/index.ts gateway/test/routes.test.ts
git commit -m "Add gateway skeleton: registry-backed /s/:id, /services routes"
```

---

## Task 3: Nullifier verification (#7)

**Files:**
- Create: `gateway/src/verify.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/test/verify.test.ts`

**Interfaces:**
- Consumes: `VerifyResult`, `Verify` (Task 2)
- Produces:
  ```ts
  export type NullifierEvent = { nullifier: string; serviceId: string };
  export type Unsubscribe = () => void;
  export type SubscribeFn = (
    vaultAddress: string,
    onEvent: (event: NullifierEvent) => void,
    onError: (err: unknown) => void
  ) => Unsubscribe;

  export function createVerifier(subscribe: SubscribeFn, vaultAddress: string): Verify;
  export function createIndexerSubscribe(indexerWsUrl: string): SubscribeFn;
  ```

**Known unknown, read before starting:** the exact GraphQL field path for reading the vault's `nullifiers` set off the indexer (inside `createIndexerSubscribe`'s `parseNullifierEvent`) is unconfirmed — `docs.midnight.network/api-reference/midnight-indexer` documents a `contractActions(address)` subscription but this plan does not have the exact response shape verified against a live schema. This is deliberately isolated to one small function. Everything else in this task (timeout, matching, reconnect-on-drop, settle-once) is fully covered by unit tests with a fake `subscribe`, independent of that unknown. Step 8 below is a manual confirmation step against Preview, to run once #5 has deployed the vault — do not skip it, and do not treat the automated tests in Step 5 as proof this works against the real indexer.

- [ ] **Step 1: Write the failing tests for `createVerifier` (pure logic, no network)**

```ts
// gateway/test/verify.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createVerifier, type SubscribeFn } from '../src/verify.js';

function fakeSubscribe(events: Array<{ nullifier: string; serviceId: string }> = []): SubscribeFn {
  return (_vaultAddress, onEvent) => {
    for (const event of events) onEvent(event);
    return () => {};
  };
}

describe('createVerifier', () => {
  it('resolves confirmed when the nullifier appears for the expected service', async () => {
    const verify = createVerifier(fakeSubscribe([{ nullifier: 'n1', serviceId: 'svc1' }]), 'vault-address');
    expect(await verify('n1', 'svc1', 1000)).toBe('confirmed');
  });

  it('resolves wrong-service when the nullifier belongs to a different service', async () => {
    const verify = createVerifier(fakeSubscribe([{ nullifier: 'n1', serviceId: 'other-svc' }]), 'vault-address');
    expect(await verify('n1', 'svc1', 1000)).toBe('wrong-service');
  });

  it('ignores events for a different nullifier and times out', async () => {
    vi.useFakeTimers();
    const verify = createVerifier(fakeSubscribe([{ nullifier: 'someone-elses', serviceId: 'svc1' }]), 'vault-address');
    const pending = verify('n1', 'svc1', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe('timeout');
    vi.useRealTimers();
  });

  it('treats subscribe errors as noise and still resolves on a later matching event', async () => {
    const subscribe: SubscribeFn = (_vaultAddress, onEvent, onError) => {
      onError(new Error('API-WS ... 1006 Abnormal Closure'));
      onEvent({ nullifier: 'n1', serviceId: 'svc1' });
      return () => {};
    };
    const verify = createVerifier(subscribe, 'vault-address');
    expect(await verify('n1', 'svc1', 1000)).toBe('confirmed');
  });

  it('unsubscribes exactly once after settling', async () => {
    const unsubscribe = vi.fn();
    const subscribe: SubscribeFn = (_vaultAddress, onEvent) => {
      onEvent({ nullifier: 'n1', serviceId: 'svc1' });
      onEvent({ nullifier: 'n1', serviceId: 'svc1' }); // duplicate event, must not double-settle
      return unsubscribe;
    };
    const verify = createVerifier(subscribe, 'vault-address');
    await verify('n1', 'svc1', 1000);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- verify.test.ts`
Expected: FAIL — `Cannot find module '../src/verify.js'`

- [ ] **Step 3: Install dependencies**

```bash
npm install graphql-ws ws -w gateway
npm install -D @types/ws -w gateway
```

- [ ] **Step 4: Write `createVerifier`**

```ts
// gateway/src/verify.ts
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import type { Verify, VerifyResult } from './routes.js';

export type NullifierEvent = { nullifier: string; serviceId: string };
export type Unsubscribe = () => void;
export type SubscribeFn = (
  vaultAddress: string,
  onEvent: (event: NullifierEvent) => void,
  onError: (err: unknown) => void
) => Unsubscribe;

export function createVerifier(subscribe: SubscribeFn, vaultAddress: string): Verify {
  return function watchForNullifier(nullifier, serviceId, timeoutMs) {
    return new Promise<VerifyResult>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => finish('timeout'), timeoutMs);

      function finish(result: VerifyResult) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      }

      const unsubscribe = subscribe(
        vaultAddress,
        (event) => {
          if (event.nullifier !== nullifier) return;
          finish(event.serviceId === serviceId ? 'confirmed' : 'wrong-service');
        },
        () => {
          // Transient socket errors (including 1006 abnormal closure) are
          // noise during indexer sync, per constraints.md. Ignore them —
          // createIndexerSubscribe reconnects internally, and this promise
          // is governed by the timeout above, not by socket health.
        }
      );
    });
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w gateway -- verify.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Write the failing test for `createIndexerSubscribe`'s reconnect plumbing**

```ts
// append to gateway/test/verify.test.ts
import { beforeEach } from 'vitest';

const subscribeMock = vi.fn();
const disposeMock = vi.fn();

vi.mock('graphql-ws', () => ({
  createClient: () => ({ subscribe: subscribeMock, dispose: disposeMock }),
}));
vi.mock('ws', () => ({ default: class {} }));

describe('createIndexerSubscribe', () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    disposeMock.mockReset();
  });

  it('reconnects when the subscription errors', async () => {
    const { createIndexerSubscribe } = await import('../src/verify.js');
    let observer: { error: (err: unknown) => void } | undefined;
    subscribeMock.mockImplementation((_payload, obs) => {
      observer = obs;
    });

    const subscribe = createIndexerSubscribe('wss://example.invalid');
    subscribe('vault-address', () => {}, () => {});

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    observer?.error(new Error('1006'));
    expect(subscribeMock).toHaveBeenCalledTimes(2);
  });

  it('disposes the client when unsubscribed', async () => {
    const { createIndexerSubscribe } = await import('../src/verify.js');
    subscribeMock.mockImplementation(() => {});
    const subscribe = createIndexerSubscribe('wss://example.invalid');
    const unsubscribe = subscribe('vault-address', () => {}, () => {});
    unsubscribe();
    expect(disposeMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 7: Run to verify it fails, then write `createIndexerSubscribe`**

Run: `npm test -w gateway -- verify.test.ts`
Expected: FAIL — `createIndexerSubscribe is not exported`

Append to `gateway/src/verify.ts`:

```ts
// NOTE: exact subscription shape is UNCONFIRMED against the live indexer
// schema. contractActions(address) is the closest documented subscription
// for "watch a contract address for updates" per
// docs.midnight.network/api-reference/midnight-indexer, but the field path
// to the newly-added nullifier and the pay() call's serviceId argument
// needs manual confirmation — see Step 8 in the implementation plan.
const WATCH_QUERY = `
  subscription WatchVault($address: String!) {
    contractActions(address: $address) {
      state
    }
  }
`;

function parseNullifierEvent(data: unknown): NullifierEvent | null {
  const action = (data as { contractActions?: { state?: { newNullifier?: string; serviceId?: string } } })
    ?.contractActions;
  if (!action?.state?.newNullifier || !action.state.serviceId) return null;
  return { nullifier: action.state.newNullifier, serviceId: action.state.serviceId };
}

export function createIndexerSubscribe(indexerWsUrl: string): SubscribeFn {
  return (vaultAddress, onEvent, onError) => {
    let disposed = false;
    let client = connect();

    function connect() {
      const c = createClient({ url: indexerWsUrl, webSocketImpl: WebSocket });
      c.subscribe(
        { query: WATCH_QUERY, variables: { address: vaultAddress } },
        {
          next: (message) => {
            const event = parseNullifierEvent(message.data);
            if (event) onEvent(event);
          },
          error: (err) => {
            onError(err);
            if (!disposed) client = connect();
          },
          complete: () => {
            if (!disposed) client = connect();
          },
        }
      );
      return c;
    }

    return () => {
      disposed = true;
      client.dispose();
    };
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -w gateway -- verify.test.ts`
Expected: PASS, 7 tests total

- [ ] **Step 9: Wire it into `index.ts`**

```ts
// gateway/src/index.ts — replace the verify stub
import { createVerifier, createIndexerSubscribe } from './verify.js';
// ...
const verify = createVerifier(createIndexerSubscribe(config.indexerWsUrl), config.vaultAddress);

const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify,
  probeOrigin: async () => true, // replaced in Task 6 (#17)
  dispatch: async () => new Response(null, { status: 501 }), // replaced in Tasks 4-5 (#8, #12)
});
```

- [ ] **Step 10: Typecheck, run the full suite, and commit**

```bash
npm run typecheck -w gateway
npm test -w gateway
git add gateway/src/verify.ts gateway/src/index.ts gateway/test/verify.test.ts gateway/package.json gateway/package-lock.json
git commit -m "Add indexer nullifier watcher, wire into gateway routes"
```

- [ ] **Step 11 (manual, blocked on #5): confirm the indexer schema against Preview**

Once #5 has deployed the vault and produced at least one `pay()` transaction on Preview:

1. Open `https://indexer.preview.midnight.network/api/v4/graphql` in a GraphQL client (or use introspection) and confirm the actual subscription/field names for reading a contract's ledger-state nullifier updates.
2. Update `WATCH_QUERY` and `parseNullifierEvent` in `gateway/src/verify.ts` to match.
3. Manually run the gateway against Preview, submit a real `pay()`, and confirm `watchForNullifier` resolves `'confirmed'` within a reasonable window.
4. Remove the "UNCONFIRMED" comment above `WATCH_QUERY` once verified, and commit the fix with a message describing what changed and why (e.g. `Fix indexer subscription field path against live Preview schema`).

---

## Task 4: Origin adapter (#8)

**Files:**
- Create: `gateway/src/dispatch.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/test/dispatch.test.ts`

**Interfaces:**
- Consumes: `Service`, `Dispatch` (Task 2)
- Produces:
  ```ts
  export function dispatchOrigin(service: Service, req: Request, timeoutMs?: number): Promise<Response>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// gateway/test/dispatch.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- dispatch.test.ts`
Expected: FAIL — `Cannot find module '../src/dispatch.js'`

- [ ] **Step 3: Write `dispatchOrigin`**

```ts
// gateway/src/dispatch.ts
import { PAYMENT_HEADER, type Service } from '@m402/shared';
import type { Dispatch } from './routes.js';

export async function dispatchOrigin(service: Service, req: Request, timeoutMs = 10_000): Promise<Response> {
  const incoming = new URL(req.url);
  const suffix = incoming.pathname.replace(/^\/s\/[^/]+/, '');
  const target = new URL(service.target);
  target.pathname = target.pathname.replace(/\/$/, '') + suffix;
  target.search = incoming.search;

  const headers = new Headers(req.headers);
  headers.delete(PAYMENT_HEADER);
  headers.delete('host');

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error -- Node's fetch (undici) requires `duplex` for a streamed body; not yet in lib.dom types
      duplex: hasBody ? 'half' : undefined,
      signal: controller.signal,
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return new Response(null, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w gateway -- dispatch.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Wire the origin path into `index.ts`**

```ts
// gateway/src/index.ts — replace the dispatch stub
import { dispatchOrigin } from './dispatch.js';
// ...
const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify,
  probeOrigin: async () => true, // replaced in Task 6 (#17)
  dispatch: async (service, req) =>
    service.type === 'origin' ? dispatchOrigin(service, req) : new Response(null, { status: 501 }), // relay lands in Task 5 (#12)
});
```

- [ ] **Step 6: Typecheck, run the full suite, and commit**

```bash
npm run typecheck -w gateway
npm test -w gateway
git add gateway/src/dispatch.ts gateway/src/index.ts gateway/test/dispatch.test.ts
git commit -m "Add origin HTTP proxy adapter"
```

---

## Task 5: Relay adapter (#12)

**Files:**
- Modify: `gateway/src/dispatch.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/test/dispatch.test.ts`

**Interfaces:**
- Consumes: `Service` (with `type: 'relay'`, `target`, `chain`), `Dispatch`
- Produces:
  ```ts
  export function chainFromCaip2(caip2: string): Chain; // viem Chain
  export function loadRelayerPrivateKey(path: string): `0x${string}`;
  export function createRelayDispatcher(relayerKeyFile: string): Dispatch;
  export function createDispatch(dispatchOriginFn: Dispatch, dispatchRelayFn: Dispatch): Dispatch;
  ```

**Note per Global Constraints:** the relayer's private key is loaded from a file path (`loadRelayerPrivateKey`), never taken directly from an env var's value. `config.relayerKeyFile` (added in Task 2) holds the *path*; the key content lives in a gitignored file on disk.

**Note on startup:** `createRelayDispatcher` takes the key *file path*, not the key itself, and only reads it lazily on the first relay dispatch (memoized after that). If it read the key eagerly at gateway startup, the whole server would fail to boot without a `relayer.key` file present — even for a deployment that only serves origin-type services. Lazy loading means the gateway starts fine with no key file; it only fails when something actually tries to use the relay path.

Full end-to-end relay behavior (a real x402 service, USDC payment, response returned) is validated manually — that's what #12's own checklist item "At least one real x402 service registered and working end to end" is for. The tests here cover everything deterministic: chain selection, key loading/validation, error handling, and routing.

- [ ] **Step 1: Write the failing tests**

```ts
// append to gateway/test/dispatch.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- dispatch.test.ts`
Expected: FAIL — `chainFromCaip2 is not exported` (and similar for the others)

- [ ] **Step 3: Install dependencies**

```bash
npm install viem x402-fetch -w gateway
```

- [ ] **Step 4: Add the relay branch to `dispatch.ts`**

```ts
// append to gateway/src/dispatch.ts
import { readFileSync } from 'node:fs';
import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { wrapFetchWithPayment } from 'x402-fetch';

const CHAINS_BY_EIP155_ID: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
};

export function chainFromCaip2(caip2: string): Chain {
  const [namespace, reference] = caip2.split(':');
  if (namespace !== 'eip155') throw new Error(`unsupported CAIP-2 namespace: ${namespace}`);
  const chain = CHAINS_BY_EIP155_ID[Number(reference)];
  if (!chain) throw new Error(`no viem chain wired up for eip155:${reference}`);
  return chain;
}

export function loadRelayerPrivateKey(path: string): `0x${string}` {
  const content = readFileSync(path, 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(content)) {
    throw new Error(`relayer key file ${path} does not contain a 32-byte hex private key`);
  }
  return content as `0x${string}`;
}

// The relayer is a trusted operator fronting USDC on the agent's behalf —
// this is the one place in the gateway that signs and spends, and it is
// scoped to exactly that: viem's client here has no access to vault funds.
export function createRelayDispatcher(relayerKeyFile: string): Dispatch {
  let cachedKey: `0x${string}` | undefined;

  return async function dispatchRelay(service, req) {
    if (!service.chain) throw new Error(`relay service ${service.id} is missing chain`);
    const chain = chainFromCaip2(service.chain);
    cachedKey ??= loadRelayerPrivateKey(relayerKeyFile);
    const account = privateKeyToAccount(cachedKey);
    const walletClient = createWalletClient({ account, chain, transport: http() });
    const payFetch = wrapFetchWithPayment(fetch, walletClient);

    try {
      const upstream = await payFetch(service.target, {
        method: req.method,
        headers: req.headers,
      });
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    } catch (err) {
      console.error('relay dispatch failed after a possible USDC payment — absorbed as relayer loss', {
        serviceId: service.id,
        target: service.target,
        error: err,
      });
      return new Response(null, { status: 502 });
    }
  };
}

export function createDispatch(dispatchOriginFn: Dispatch, dispatchRelayFn: Dispatch): Dispatch {
  return (service, req) => (service.type === 'origin' ? dispatchOriginFn(service, req) : dispatchRelayFn(service, req));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w gateway -- dispatch.test.ts`
Expected: PASS, 12 tests total in this file (3 from Task 4 + 9 new)

- [ ] **Step 6: Wire the full dispatch into `index.ts`**

```ts
// gateway/src/index.ts — replace the dispatch wiring from Task 4
import { dispatchOrigin, createDispatch, createRelayDispatcher } from './dispatch.js';
// ...
const dispatch = createDispatch(dispatchOrigin, createRelayDispatcher(config.relayerKeyFile));

const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify,
  probeOrigin: async () => true, // replaced in Task 6 (#17)
  dispatch,
});
```

- [ ] **Step 7: Add the relayer key file to `.gitignore` if not already covered**

Run: `grep -n "relayer" gateway/.gitignore .gitignore 2>/dev/null || echo "not covered"`

If not covered, add `relayer.key` to `gateway/.gitignore` (create the file if it doesn't exist).

- [ ] **Step 8: Typecheck, run the full suite, and commit**

```bash
npm run typecheck -w gateway
npm test -w gateway
git add gateway/src/dispatch.ts gateway/src/index.ts gateway/test/dispatch.test.ts gateway/package.json gateway/package-lock.json gateway/.gitignore
git commit -m "Add EVM relay adapter with CAIP-2 chain selection"
```

---

## Task 6: Origin health-check before returning 402 (#17)

**Files:**
- Create: `gateway/src/health.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/test/health.test.ts`

**Interfaces:**
- Consumes: `ProbeOrigin` (Task 2)
- Produces:
  ```ts
  export function createHealthProbe(ttlMs?: number): ProbeOrigin;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// gateway/test/health.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHealthProbe } from '../src/health.js';

describe('createHealthProbe', () => {
  let server: Server;
  let baseUrl: string;
  let status = 200;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(status);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : '';
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns true for a healthy origin', async () => {
    status = 200;
    const probe = createHealthProbe(5000);
    expect(await probe(baseUrl)).toBe(true);
  });

  it('returns false for a 5xx origin', async () => {
    status = 503;
    const probe = createHealthProbe(5000);
    expect(await probe(baseUrl)).toBe(false);
  });

  it('returns false for an unreachable origin', async () => {
    const probe = createHealthProbe(5000);
    expect(await probe('http://127.0.0.1:1')).toBe(false);
  });

  it('caches a result within the TTL — only one real probe for two calls', async () => {
    status = 200;
    hits = 0;
    const probe = createHealthProbe(5000);
    await probe(baseUrl);
    await probe(baseUrl);
    expect(hits).toBe(1);
  });

  it('re-probes once the TTL has expired', async () => {
    status = 200;
    hits = 0;
    const probe = createHealthProbe(50);
    await probe(baseUrl);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await probe(baseUrl);
    expect(hits).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w gateway -- health.test.ts`
Expected: FAIL — `Cannot find module '../src/health.js'`

- [ ] **Step 3: Write `health.ts`**

```ts
// gateway/src/health.ts
import type { ProbeOrigin } from './routes.js';

type CacheEntry = { healthy: boolean; expiresAt: number };

export function createHealthProbe(ttlMs = 5000): ProbeOrigin {
  const cache = new Map<string, CacheEntry>();

  return async function probeOrigin(target) {
    const now = Date.now();
    const cached = cache.get(target);
    if (cached && cached.expiresAt > now) return cached.healthy;

    let healthy: boolean;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      // HEAD, not GET: this only asks "is something listening and not
      // erroring", not "does this exact route respond" — a 405 from an
      // origin that doesn't support HEAD still counts as reachable.
      const res = await fetch(target, { method: 'HEAD', signal: controller.signal });
      healthy = res.status < 500;
    } catch {
      healthy = false;
    } finally {
      clearTimeout(timer);
    }

    cache.set(target, { healthy, expiresAt: now + ttlMs });
    return healthy;
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w gateway -- health.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Wire it into `index.ts`**

```ts
// gateway/src/index.ts — replace the probeOrigin stub
import { createHealthProbe } from './health.js';
// ...
const app = createRoutes({
  registry,
  vaultAddress: config.vaultAddress,
  verifyTimeoutMs: config.verifyTimeoutMs,
  verify,
  probeOrigin: createHealthProbe(),
  dispatch,
});
```

- [ ] **Step 6: Typecheck, run the full suite, and commit**

```bash
npm run typecheck -w gateway
npm test -w gateway
git add gateway/src/health.ts gateway/src/index.ts gateway/test/health.test.ts
git commit -m "Add origin health-check before returning 402"
```

---

## Final verification

- [ ] **Run the complete gateway suite and typecheck one more time**

```bash
npm test -w gateway
npm run typecheck -w gateway
```

Expected: all tests pass (registry: 5, routes: 13, verify: 7, dispatch: 12, health: 5 — 42 total), no type errors.

- [ ] **Manually start the gateway and sanity-check the skeleton**

```bash
npm run dev -w gateway
```

In another terminal:
```bash
curl -i http://localhost:8787/healthz
curl -i http://localhost:8787/services
curl -i -X POST http://localhost:8787/services \
  -H 'content-type: application/json' \
  -d '{"id":"demo","price":"500","owner":"0xtest","type":"origin","target":"https://example.com"}'
curl -i http://localhost:8787/s/demo
```

Expected: `healthz` → `ok`; empty `services` list initially, then one row after the POST; `GET /s/demo` → `402` with `{"serviceId":"demo","price":"500","vaultAddress":""}` (empty `vaultAddress` is expected until `VAULT_ADDRESS` is set from #5's deployment).

This confirms #6 works standalone. #7's live-indexer behavior and #12's live-relay behavior remain gated on Task 3 Step 11 and a real x402 service respectively — both are manual, out of this automated suite by design.
