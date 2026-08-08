# Gateway design

> **Superseded.** Written against the pre-receipt-model contract (nullifier-based
> verification, `deriveServiceId(owner, salt)`). The contract changed mid-implementation to a
> receipt-secret model with no nullifier, plus an on-chain registration-ownership check the
> gateway now performs. For current behavior see [`../../../gateway/README.md`](../../../gateway/README.md)
> and [`../../design.md`](../../../docs/design.md#5-gateway) — both reflect what's actually
> built. Kept here for planning-history context only.

Covers the five gateway-side issues assigned to MartinLecam, built as one cohesive service:

- **#6** — Gateway skeleton: resolve `/s/:id`, return 402
- **#7** — Indexer nullifier watcher over GraphQL-WS
- **#8** — Origin adapter: HTTP proxy to merchant URL
- **#12** — Relay adapter: x402 client with CAIP-2 chain selection
- **#17** — Origin health-check before returning 402

Architecture and protocol context: [`../../design.md`](../../../docs/design.md#5-gateway),
[`../../stack.md`](../../../docs/stack.md#gateway),
[`../../architecture/payment-flow.md`](../../../docs/architecture/payment-flow.md).

Not covered here: #15 (dev CLI) and #9 (agent CLI) are separate packages that *consume* the
interfaces this spec produces (`POST /services`, `GET /s/:id`). They are out of scope for this
spec.

---

## 1. Architecture

```
gateway/src/
  config.ts      PORT, VAULT_ADDRESS, DB_PATH, INDEXER_WS_URL — reads env once, exported as a const

  registry.ts    better-sqlite3 connection + schema + data access
                   get(id: string): Service | undefined
                   list(): Service[]
                   insert(row: Service): 'created' | 'conflict'

  verify.ts      watchForNullifier(nullifier, serviceId, timeoutMs):
                     Promise<'confirmed' | 'wrong-service' | 'timeout'>        — #7
                   Owns the GraphQL-WS subscription to the indexer, including
                   reconnect-on-drop.

  dispatch.ts    dispatch(service: Service, req: Request): Promise<Response>  — #8 + #12
                   Switches on service.type: 'origin' branch is a plain HTTP proxy,
                   'relay' branch is a viem-backed x402 client keyed off service.chain.

  health.ts      probeOrigin(target: string): Promise<boolean>                — #17
                   Short-TTL cache (5s) keyed by target, so repeated requests to the
                   same service don't re-probe on every call.

  routes.ts      Hono routes, the only file that imports the other four:
                   GET  /s/:id       — 404 / health-check+402 / verify+dispatch
                   GET  /services    — list(), for #11 (explorer)
                   POST /services    — insert(), for #10 (publish form) / #15 (dev CLI)

  index.ts       (existing) creates the Hono app, mounts routes.ts, starts the server
```

`index.ts` stays what it is today plus one `app.route(...)` call. Every other file is a plain
function with no Hono dependency — `dispatch()`, `probeOrigin()`, `watchForNullifier()` are
each callable and testable directly, no HTTP round-trip required.

This is not a layered controller/service framework — there's no DI, no interfaces, no
repository abstraction. The five files map 1:1 onto the five issues above, built in that
order; each issue adds a file instead of reopening one that already carries a prior issue's
code.

### Registry write path

`#10` and `#15` both need to get service data into the gateway's SQLite registry, and neither
issue owns building that path — it belongs here, alongside the read path it's a mirror of.
`POST /services` is unauthenticated (matches the project's non-custodial, no-gateway-secrets
model — the gateway holds no keys to check anything against) and **first-write-wins**: a
second `POST` for an existing `serviceId` is rejected with 409, mirroring the on-chain
`registerService` immutability guard (`Map.insert` would silently overwrite without it).

### Registry schema (SQLite via better-sqlite3)

One table, one file on disk (`DB_PATH`), per `stack.md`'s reasoning — one process, ~10 rows,
no hosted database needed.

```sql
CREATE TABLE services (
  id     TEXT PRIMARY KEY,      -- serviceId, 32 random bytes as hex
  price  TEXT NOT NULL,         -- bigint, stored as decimal string (SQLite has no native bigint)
  owner  TEXT NOT NULL,         -- merchant's Lace address
  type   TEXT NOT NULL,         -- 'origin' | 'relay'
  target TEXT NOT NULL,         -- origin: proxy URL · relay: pay-and-fetch URL
  chain  TEXT                   -- CAIP-2 id, relay only, e.g. 'eip155:8453'
);
```

`registry.ts` converts `price` between the stored decimal string and the `Service.price:
bigint` field from `shared/` at the read/write boundary — the same bigint-over-JSON problem
the wire format solves by using `string` in `PaymentRequired`.

---

## 2. Data flow — `GET /s/:id`

```
lookup service in registry
  not found                          → 404

found, no X-Payment header:
  type === 'origin'
    probeOrigin(target) fails        → 503 { reason: 'origin-down' }
    probeOrigin(target) ok           → 402 { serviceId, price, vaultAddress }
  type === 'relay'  (not probed — documented gap, see below)
                                      → 402 { serviceId, price, vaultAddress }

found, X-Payment: <nullifier> header present:
  watchForNullifier() → 'confirmed'
    dispatch(service, req)
      origin: proxy → origin's status/headers/body verbatim
              origin unreachable/timeout → 504  (distinguishable from the 503 above —
                                                   payment already landed here)
      relay:  x402 client → external response verbatim
              external failure after paying USDC → logged as relayer loss, not swallowed
  watchForNullifier() → 'wrong-service'  (nullifier exists, but for a different serviceId)
                                      → 402 { serviceId, price, vaultAddress }  — unpaid, for this service
  watchForNullifier() → 'timeout'
                                      → 503 { reason: 'payment-pending' }, Retry-After: 5
```

**Relay services are not health-checked** (#17's checklist explicitly allows documenting this
instead of implementing it): relay targets speak the x402 protocol and 402 on a plain probe
request, so a generic reachability check can't distinguish "healthy but requires payment" from
"actually down" without performing a real payment. Not worth building for a stretch issue.

**Both 503s share a status code but carry a distinct `reason`** so the agent CLI (#9) can tell
"don't bother paying, origin is down" from "you paid, keep polling" apart programmatically,
not just via `Retry-After`.

`dispatch.ts`'s origin branch strips `X-Payment` before forwarding to the merchant, per #8's
checklist — merchants must not see payment internals.

`vaultAddress` in the 402 body is a single global value from `config.ts` (`VAULT_ADDRESS`) —
one vault contract per deployment, not per-service.

---

## 3. Error handling

Full status surface for `GET /s/:id`:

| Status | When | Body |
|---|---|---|
| 404 | unknown `serviceId` | — |
| 402 | no payment yet, or nullifier belongs to a different service | `{ serviceId, price, vaultAddress }` |
| 503 | origin health-check failed | `{ reason: 'origin-down' }` |
| 503 | verification timed out (payment status unknown) | `{ reason: 'payment-pending' }`, `Retry-After: 5` |
| 504 | origin/relay unreachable **after** payment confirmed | — |
| 200 | verified and dispatched | origin/relay response verbatim |

`POST /services`:

| Status | When |
|---|---|
| 400 | missing/malformed field (e.g. `type: 'relay'` without `chain`) |
| 409 | `serviceId` already registered |
| 201 | inserted |

Two edge cases worth naming explicitly:

- **Indexer socket drop mid-watch** (`API-WS ... 1006 Abnormal Closure`, called out in #7) is
  swallowed and reconnected inside `verify.ts` — it never surfaces as `timeout` to the route
  unless the full `timeoutMs` window elapses with no confirmation. Per `constraints.md`,
  indexer subscriptions replay from genesis, so a short listen window is indistinguishable
  from genuine no-activity — `timeoutMs` defaults to a generous window (~60s, per `design.md`).
- **Relay dispatch failing after paying USDC** is a real loss with no refund path (per the
  failure-modes table in `design.md`). It's logged via `console.error` with enough detail to
  reconcile manually (serviceId, nullifier, external tx if any) — no retry, no silent swallow.
  No logging infra exists elsewhere in the repo, so none is introduced here; a proper sink is
  out of scope until something depends on it.

---

## 4. Testing

- **`registry.ts`** — unit tests against a real `:memory:` better-sqlite3 instance (fast
  enough, no mocking needed).
- **`health.ts`** and **`dispatch.ts`'s origin branch** — unit tests against a local test HTTP
  server or mocked `fetch`.
- **`verify.ts`** — unit tests against a fake WS server or a mocked graphql-ws client. Never
  the real Preview indexer in automated tests.
- **`dispatch.ts`'s relay branch** — unit tests with a mocked viem client.
- **`routes.ts`** — Hono's `app.request()` test helper, with the four modules mocked via
  `vi.mock` so route tests assert status codes and bodies without touching SQLite or the
  network.
- No live-network tests in CI. A manual smoke test against Preview (real vault, real indexer)
  happens once #5 (vault deployed to Preview) lands — tracked there, not automated here.

---

## 5. Build order

Matches the issue numbers and the file list in §1 — each step leaves the gateway in a working,
demoable state:

1. **#6** — `config.ts`, `registry.ts`, `routes.ts` (skeleton: 404/402/`GET /services`/`POST
   /services`). `X-Payment` present but unverifiable yet → wire the call site to `verify.ts`
   with a stub that always returns `'timeout'`.
2. **#7** — `verify.ts` real implementation, swapped in.
3. **#8** — `dispatch.ts`'s origin branch.
4. **#12** — `dispatch.ts`'s relay branch.
5. **#17** — `health.ts`, wired into the no-`X-Payment` origin path.

Each step is independently mergeable and testable per §4 without waiting on the next.
