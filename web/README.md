# web

Marketplace and explorer. Talks to three things directly: the gateway (`GET/POST /services`,
`GET /s/:id`), the Midnight Preview indexer (read-only ledger state, no wallet needed), and a
Lace-family wallet via the DApp Connector API (registerService/pay/withdraw). Holds no keys —
Lace proves and signs every transaction; the gateway never sees them either.

## Running

```bash
cp .env.example .env           # then edit if your setup differs from the defaults
npm run compile -w contracts   # generates contracts/src/managed/m402Vault — zkir + prover/verifier keys
npm run dev -w web             # predev copies those into web/public/managed/m402Vault, then vite
```

Also needs, for the write paths (Publish/pay/Withdraw):

- A local proof server on `:6300` (see repo README) — proving happens via `httpClientProofProvider`
  pointed at it, same as the CLI agent, not wallet-delegated proving (`chain/providers.ts` explains why).
- A Lace-family wallet extension holding tNIGHT (Publish, Withdraw) or already-deposited m402
  credit from `m402 deposit` via the agent CLI (paying a service).
- The gateway running and reachable — `npm run dev -w gateway`, or set `VITE_M402_GATEWAY_URL`.

Reading the explorer needs none of the above — it's a plain `GET /services` plus indexer reads.

## Environment

`src/chain/config.ts` reads every `VITE_M402_*` variable below at module load and throws a clear
error if one's missing — there are no hardcoded fallbacks in source. Vite loads `web/.env`
automatically (built in, no extra package); restart the dev server after editing it.

| Variable | Notes |
|---|---|
| `VITE_M402_GATEWAY_URL` | Where `lib/gateway.ts` sends `/services` and `/s/:id` |
| `VITE_M402_VAULT_ADDRESS` | Must match the gateway's `VAULT_ADDRESS` and the agent's `M402_VAULT_ADDRESS` |
| `VITE_M402_INDEXER_URL` / `VITE_M402_INDEXER_WS_URL` | Preview indexer |
| `VITE_M402_PROOF_SERVER` | *(optional)* Only if your proof server isn't at the wallet's `substrateNodeUri` on port 6300 |

## Browser SDK layer — `src/chain/`

The Midnight SDK targets Node by default; `src/chain/` is what makes it run in a wallet-connected
tab instead of the CLI agent (`contracts/src/client.ts`, which builds its own seed-derived wallet
and is Node-only).

| File | Responsibility |
|---|---|
| `providers.ts` | Assembles the 6 providers `submitCallTxAsync` needs from a connected Lace session — indexer, ZK config, proof server, wallet-backed balance/submit, in-memory private state |
| `zkConfigProvider.ts` | Fetches zkir/prover/verifier keys as static assets instead of off disk (`@midnight-ntwrk/midnight-js-fetch-zk-config-provider` doesn't exist at this SDK version — see file comment) |
| `indexerProvider.ts` | Works around `isomorphic-ws`'s browser build only default-exporting — the SDK's own default `webSocketImpl` silently resolves to `undefined` in a browser bundle otherwise |
| `witnesses.ts` | Browser counterpart to `contracts/src/witnesses.ts` — same semantics, Web Crypto instead of node:crypto |
| `privateState.ts` | In-memory `PrivateStateProvider` — nothing durable to back it with in a tab; lost on refresh, reconstructed from public ledger where needed |
| `contract.ts` | The compiled contract bound to browser witnesses (no `withCompiledFileAssets` — confirmed against the SDK's own implementation that `submitCallTxAsync` sources ZK config from `providers.zkConfigProvider`, not the compiled contract's file-assets path) |
| `circuits.ts` | `registerServiceOnChain` / `payForService` / `withdrawBalance` — the actual `submitCallTxAsync` calls |
| `address.ts` | Decodes a wallet's Bech32m unshielded address into the raw 32 bytes `owner`/`recipient` need |
| `ledger.ts` | One-shot reads of the vault's typed public ledger (`servicePrice`, `serviceOwner`, `merchantBalance`, `receipts`) — no wallet needed |

`lib/gateway.ts` is the separate, ordinary HTTP client for the gateway's own endpoints.

## What's real, what isn't

Every screen reads and writes the actual vault and the actual gateway — no mocked data. Two
things are inherent to what's on-chain, not gaps in the wiring:

- The registry has no service name/description (`docs/design.md#5` — only
  `id/price/owner/type/target/chain`), so the UI labels services by their target's hostname.
- `receipts` isn't scoped per service (the contract has one global set), so ServiceScreen's
  "on-chain receipts" shows the vault's most recent entries, not this service's.

See [`../docs/design.md`](../docs/design.md#6-registration-and-explorer).
