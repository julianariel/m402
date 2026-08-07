# Stack

Tooling decisions, so four directories built in parallel stay compatible.

## Runtime

- **Node 22 or 24.** Not 23, not 26 — both break the Midnight SDK's ESM resolution. Failures
  surface as `ERR_PACKAGE_PATH_NOT_EXPORTED` inside a `tsx` stack trace, which reads like a
  dependency problem. Check `node -v` first.
- **TypeScript**, ESM throughout.
- **npm workspaces.** Ships with Node, so there is no install step for anyone joining.
- **Vitest** for tests.

## Layout

```
shared/      types imported by every other package — see below
contracts/   m402Vault.compact + deploy and measurement scripts
gateway/     Hono service: 402, nullifier watch, origin + relay dispatch
agent/       CLI: deposit, call
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

export const PAYMENT_HEADER = 'X-Payment';   // value: nullifier hex
```

A second definition of `Service` is a merge conflict at hour 20, in the code path that
carries the money.

## Gateway

**Hono.** Small, TypeScript-first, and its middleware is portable if the roadmap's
merchant-side middleware ever happens.

**Registry: SQLite via `better-sqlite3`**, one file on disk. `serviceId → URL` cannot live
on-chain, so the gateway owns it — and an in-memory map means a restart erases every service
already demoed with. Ten minutes of work against losing the demo.

**The gateway must be a long-lived process.** It holds a GraphQL-WS subscription to the
indexer, so serverless is the wrong shape. This is also why the registry does not need a
hosted database: one process, one file, ~10 rows.

## Web

**Vite + React + Tailwind.** The Lace connector is `window.midnight`, which is client-only —
a static SPA avoids fighting SSR and hydration for no benefit.

## EVM

**viem**, with the client selected from the `Service.chain` CAIP-2 string. Base is used for
development because that is where the x402 ecosystem is; nothing is Base-specific.

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
