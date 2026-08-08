# gateway

Hono service: resolves `/s/:id`, verifies payment, and dispatches to an origin API or an EVM
relayer. Origin mode only reads Midnight chain state. Relay mode additionally holds a funded,
dedicated EVM payer key and signs x402 payment authorizations. See
[`../docs/design.md`](../docs/design.md#5-gateway).

## Request flow

```
GET /s/:id
  no X-Payment?  → 402 { serviceId, price, vaultAddress }
                   (origin services are health-checked first — unreachable → 503, not 402)
  X-Payment?     → hash the secret with deriveReceipt(secret, serviceId),
                   check the on-chain `receipts` set, then check the local consumed set
                   → confirmed        → dispatch
                   → replayed         → 402 { reason: 'receipt-already-used' }
                   → wrong-service    → 402 (payment body) — secret paid a different service
                   → timeout          → 503 { reason: 'payment-pending' }, Retry-After: 5

POST /services   register a service in the gateway's own off-chain registry
  → checks serviceOwner[id] on-chain against the claimed owner first:
     not yet visible on-chain → 503 { reason: 'registration-not-yet-confirmed' }
     owner mismatch           → 403 { reason: 'owner-mismatch' }
     match                    → inserted, 201 (or 409 if id already registered locally)

GET /services     lists registered services, price serialized as a string
```

`X-Payment` carries the payer's **receipt secret**, never a hash — see
[`@m402/shared`](../shared/src/index.ts) and
[`design.md`](../docs/design.md#2-request-flow). The contract has no nullifier; `receipts` is
the only on-chain set, and it proves a payment happened, never that it's still unspent — that
second half is the gateway's job (`src/consumed.ts`).

## Source layout

One file per concern, dependency-injected and independently testable. `routes.ts` is the only
file that touches Hono.

| File | Responsibility |
|---|---|
| `config.ts` | Reads env once |
| `routes.ts` | HTTP surface — `/s/:id`, `/services`; owns the `VerifyResult`/`Verify`/`Dispatch`/`ProbeOrigin` contracts |
| `registry.ts` | SQLite-backed `serviceId → { price, owner, type, target, chain }` |
| `receipt.ts` | `deriveReceipt(secret, serviceId)` — re-exported from `contracts/pure`'s compiled `pureCircuits`, never hand-rolled |
| `verify.ts` | Watches the vault's on-chain state for a receipt; `createPublicDataSubscribe` wraps the Midnight SDK's `PublicDataProvider` |
| `consumed.ts` | SQLite-backed local replay guard — one receipt redeems once |
| `ownership.ts` | Confirms `serviceOwner[id]` on-chain matches a `POST /services` claim, before it's trusted |
| `dispatch.ts` | Origin HTTP proxy + EVM relay (x402 client, CAIP-2 chain selection) |
| `health.ts` | TTL-cached origin health probe, run before a 402 |
| `index.ts` | Wires real implementations together, starts the server |

## Verifying a payment

The agent sends its receipt secret in `X-Payment`, never the hash — the chain only ever
records `deriveReceipt(secret, serviceId)` in the `receipts` set (`m402Vault.compact`'s
`pay` circuit). `verify.ts`:

1. Hashes the incoming secret the same way the contract does — via `pureCircuits.deriveReceipt`
   (`receipt.ts`), not a local reimplementation. Reimplementing this hash risks silent drift
   from the contract; the exported pure circuit needs no proof and costs nothing to call.
2. Checks the local **consumed set** first (`consumed.ts`) — a receipt already used once must
   not grant a second resource access, even though the on-chain set will still show it as
   valid forever (it's append-only proof-of-payment, not proof-of-freshness).
3. Subscribes to the vault's contract state via the Midnight SDK's `PublicDataProvider`
   (`contractStateObservable`, `{ type: 'latest' }`) and checks `ledger(state.data).receipts
   .member(...)` on every emission — for the target hash (→ `confirmed`) and, precomputed
   once per call, every *other* registered service's candidate hash for the same secret (→
   `wrong-service`, so a secret that paid for a different service doesn't silently degrade
   into an indistinguishable timeout).
4. Times out after `verifyTimeoutMs` (default 60s) if nothing matches. **A timeout is never
   treated as proof of non-payment** — indexer subscriptions can replay from genesis, so a
   short listen window looks identical to no activity. The client is expected to retry.

Socket errors during indexer sync (`1006 Abnormal Closure` and friends) are noise, not
failure — `createPublicDataSubscribe` reconnects and keeps waiting rather than surfacing them
as a verification failure.

## Verifying a registration

`POST /services` is a plain HTTP write into the gateway's own SQLite registry — it is **not**
watched or synced from the chain automatically. The merchant's web UI calls
`registerService(salt, price, owner)` on the vault directly (via Lace) and separately calls
`POST /services` to register the URL the gateway should route `serviceId` to, since the
contract only ever stores `serviceId → price/owner`, never the URL.

Before accepting a `POST /services` body, `ownership.ts` reads `serviceOwner[id]` from the
chain (`queryContractState` + `ledger(...).serviceOwner`) and compares it to the claimed
`owner`. This is what catches a lie about who registered on-chain — without it, the registry
would trust whatever the caller sends.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `VAULT_ADDRESS` | *(empty)* | **Required to serve real 402s and payments.** Set once the vault is deployed — see [`../contracts/README.md`](../contracts/README.md). With it unset, `/s/:id` returns `402` with an empty `vaultAddress`, and `/services` POSTs 500 (ownership checks can't query an empty contract address). |
| `DB_PATH` | `gateway.db` | SQLite file — holds both the service registry and the consumed-receipts table |
| `INDEXER_URL` | `https://indexer.preview.midnight.network/api/v4/graphql` | HTTP query endpoint |
| `INDEXER_WS_URL` | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` | Subscription endpoint |
| `RELAYER_KEY_FILE` | `./relayer.key` | Path to a file holding the relayer's private key — **never** the key itself in an env var; both argv and env-var-as-secret leak through `ps`. Read lazily, only on the first relay dispatch, so the gateway still boots without it for origin-only deployments |
| `RELAYER_MAX_PAYMENT` | `100000` | Maximum external payment per request in USDC base units (the default is 0.10 USDC) |
| `RELAY_TARGET_ALLOWLIST` | *(empty)* | Comma-separated exact external URLs accepted for relay registration. Empty denies all relay registrations; keep this list curated before funding the relayer |

## Running

```bash
npm run dev -w gateway     # tsx watch src/index.ts
npm test -w gateway        # vitest
npm run typecheck -w gateway
```

## Funding a test relayer

Use a dedicated, low-balance Base Sepolia account. The relayer is the x402 payer, so it needs
test USDC; the facilitator normally pays transaction gas. A small amount of Base Sepolia ETH
is still useful for diagnostics.

```bash
umask 077
printf '0x%s\n' "$(openssl rand -hex 32)" > gateway/relayer.key
chmod 600 gateway/relayer.key
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { privateKeyToAccount } from 'viem/accounts'; console.log(privateKeyToAccount(readFileSync('gateway/relayer.key', 'utf8').trim()).address)"
```

Fund the printed address with Base Sepolia USDC from a testnet faucet. Native USDC on Base
Sepolia is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Then start the gateway with an
absolute key path, an exact allowlisted x402 URL, and a deliberately small per-request cap:

```bash
RELAYER_KEY_FILE="$PWD/gateway/relayer.key" \
RELAY_TARGET_ALLOWLIST="https://verified.example/paid-endpoint" \
RELAYER_MAX_PAYMENT=10000 \
npm run dev -w gateway
```

`10000` is 0.01 USDC. The allowlist is a required trust boundary: without it, arbitrary
service owners could point the shared payer wallet at an endpoint they control. Keep only the
amount needed for the test in this account. The current integration uses x402 v1
(`x402-fetch@1.2.0`), so the selected endpoint must support that protocol version; migrate to
`@x402/fetch` before relying on a v2-only endpoint.

## What's manual, not automated

- **The exact indexer subscription shape is confirmed at the type level** — `contractStateObservable`
  and `queryContractState` are documented `PublicDataProvider` SDK methods, not a hand-parsed
  GraphQL query — but reconnect behaviour under a real socket drop against live Preview is
  still unverified. `createPublicDataSubscribe`'s reconnect-on-error wrapper mirrors the
  pattern in `contracts/src/test/deploy.test.ts` (which *has* run against Preview) defensively.
- **Full relay flow** (a real x402 service, USDC payment, response returned) needs manual
  verification — see #12.
- The gateway's `POST /services` ownership check was exercised against a real Preview
  `registerService` transaction. Relay dispatch remains the unverified external leg.
