# Stack

Tooling decisions, so four directories built in parallel stay compatible.

## Runtime

- **Node 22 or 24.** Not 23, not 26 — both break the Midnight SDK's ESM resolution. Failures
  surface as `ERR_PACKAGE_PATH_NOT_EXPORTED` inside a `tsx` stack trace, which reads like a
  dependency problem. Check `node -v` first.
- **TypeScript**, ESM throughout.
- **npm workspaces.** Ships with Node, so there is no install step for anyone joining.
- **Not Bun**, and not for compatibility reasons — it works. Bun loads the SDK, its WASM, and
  the native `classic-level` binding without complaint, and it starts **~2.5x faster**
  (500–620ms vs 1000–1870ms to import the SDK and initialise WASM).

  It does not help, because startup is not where the time goes. A measured `contracts` run
  against Preview takes ~228s: ~140s wallet sync over the network, ~87s of proof generation
  in the Docker proof server, ~11s in `compact compile` — a standalone binary — and ~2s of
  Node startup. Bun saves about one second in 228. The bottleneck runs no JavaScript.

  `bun install` *is* meaningfully faster than npm, but the monorepo has one lockfile, so it
  is an all-or-nothing call. One lockfile, `package-lock.json`.
- **Vitest** for tests. Proof generation dominates, so timeouts are raised in
  `contracts/vitest.config.ts` — a single circuit call is 20–30s and remote wallet sync can
  take minutes. Default timeouts fail before anything real happens.

## Layout

```
shared/      types imported by every other package — see below
contracts/   m402Vault.compact + deploy and measurement scripts
gateway/     Hono service: 402, receipt watch, origin + relay dispatch
agent/       CLI: deposit, call, redeem
web/         Vite + React + Tailwind: publish form, explorer, withdrawal
```

## `shared/` is not optional

The registry row, the 402 body, and the payment header are consumed by six issues across
three people. They live in `shared/` and are imported, never re-declared:

```ts
export type Service = {
  id: string; price: bigint; owner: string;
  type: 'origin' | 'relay';
  target: string;          // origin: proxy here · relay: pay-and-fetch here
  chain?: string;          // CAIP-2, relay only, e.g. 'eip155:8453'
};

export type PaymentRequired = {
  serviceId: string; price: string; vaultAddress: string;
};

export const PAYMENT_HEADER = 'X-Payment';   // value: receipt SECRET hex, never a hash
```

A second definition of `Service` is a merge conflict at hour 20, in the code path that
carries the money.

## Gateway

**Hono.** Small, TypeScript-first, and its middleware is portable if the roadmap's
merchant-side middleware ever happens.

**Registry: SQLite via `better-sqlite3`**, one file on disk. `serviceId → URL` cannot live
on-chain, so the gateway owns it — and an in-memory map means a restart erases every service
already demoed with. Ten minutes of work against losing the demo. The same file also holds the
consumed-receipts replay guard (`gateway/src/consumed.ts`) — a receipt secret redeems once,
and the on-chain `receipts` set alone can't enforce that, since it only proves a payment
happened, not that this particular access grant is still unspent.

**The gateway must be a long-lived process.** It holds a live subscription to the vault's
contract state (the Midnight SDK's `PublicDataProvider.contractStateObservable`, not a
hand-rolled GraphQL-WS query), so serverless is the wrong shape. This is also why the registry
does not need a hosted database: one process, one file, ~10 rows.

**`POST /services` checks the chain before trusting a registration.** It reads
`serviceOwner[id]` via `queryContractState` and compares it to the claimed owner —
`pureCircuits`/`ledger`, re-exported from `contracts/pure`, not a reimplemented hash. This is
also why `contracts` is a gateway dependency, not just a `shared`-style types package.

## Web

**Vite + React + Tailwind.** The Lace connector is `window.midnight`, which is client-only —
a static SPA avoids fighting SSR and hydration for no benefit.

## EVM

**x402 v2** — `@x402/fetch` with `@x402/evm`'s exact-payment scheme, and **viem** for the
signing account. `Service.chain` (CAIP-2) selects the one network the scheme is registered
for, so a relay service can only ever induce a payment on the chain it declared. The
per-request spend cap is a payment policy that filters offers before signing. Base is used
because that is where the x402 ecosystem is; nothing is Base-specific.

## Deployment

Local first. The gateway and proof server run on the demo machine, and the agent CLI runs
beside them — that path needs no hosting at all.

For a URL a judge can open, expose the gateway with a `cloudflared` tunnel and put `web/` on
Vercel as a static build. If time allows near the end, move the gateway to a container host
that supports long-lived processes rather than a tunnel from a laptop.

No hosted Postgres. Supabase or Neon would add an account, a network hop, and a second source
of truth for ten rows that SQLite already holds.

## Security

- The proof server stays bound to `127.0.0.1:6300`. Proof requests carry private witness data
  and the service has no authentication.
- Wallet seeds are read from a gitignored file, never from `argv` or an environment variable —
  both leak through `ps`.

## Running against Preview

Wallet material is read from a **file**, never argv and never an env var holding the words —
both leak through `ps` and shell history. The env var carries only a path.

```bash
cd contracts
MIDNIGHT_NETWORK=preview \
MIDNIGHT_PREVIEW_MNEMONIC_FILE=/path/to/.mnemonic \
npx vitest run src/test/deploy.test.ts
```

Requires the proof server on `127.0.0.1:6300` and a Preview wallet holding tNIGHT that is
**registered for DUST** — NIGHT alone is not enough to submit anything.

Verified end to end against Preview on **both Node 22.12.0 and 24.19.0** — deploy, register
and deposit pass on each.

`.nvmrc` pins **24**, matching Midnight's own `example-hello-world` template. The docs give
22 as the supported floor (`engines: >=22`), but 24 is the version their example actually
runs, so it is the better-exercised path. `engines` here allows `22.x || 24.x`, so a
teammate already on 22 is not blocked.
