# m402

**Private agentic payments on Midnight.**

x402 lets AI agents pay for APIs and data in real time, but it runs on transparent chains:
every payment reveals who paid, whom, how much, and how often. That exposes an agent's
strategy, usage volume, and counterparties.

m402 implements the same 402-and-retry flow on Midnight. The merchant learns that a correct
payment happened. The chain records that someone paid **at least** the asking price — not the
amount, not the payer.

## Two surfaces, one rail

**Marketplace** — register any HTTP API with a price and get back a wrapped URL that speaks
the x402 flow. Agents pay privately; merchants withdraw their fees.

**EVM relayer** — Midnight-native agents consume *existing* x402 services on EVM chains. The
relayer pays USDC on their behalf and returns the resource.

Both are the same primitive: an agent proves *"I am paying at least the asking price"*, and
something delivers a resource. Only the fulfilment differs — the relayer is credited in the
vault exactly like any other merchant.

## How it works

```
   0. deposit NIGHT once  ──►  shielded credit  (public, one-off)

┌─────────────┐   1. GET /s/abc          ┌──────────────────────┐
│    Agent    │ ───────────────────────► │   m402 Gateway       │
│  (CLI/SDK)  │ ◄─────────────────────── │   proxy + verifier   │
└──────┬──────┘   2. 402 + requirements  └───────┬──────────────┘
       │                                         │
       │ 3. pay() — spends credit                │ 5. watch indexer
       ▼                                         │    for nullifier
┌─────────────────────────────┐                  │
│   m402Vault.compact         │ ◄────────────────┘
│   nullifiers · balances     │                  │ 6. dispatch
│   pooled NIGHT reserve      │                  ▼
└─────────────────────────────┘  ┌───────────────┴──────────────┐
       ▲                         │  origin API    │  EVM relayer│
       │ 8. withdraw NIGHT       │  (marketplace) │  (x402 out) │
┌──────┴──────┐                  └──────────────────────────────┘
│  Merchant   │
└─────────────┘
```

The agent submits its own transaction; the gateway only reads the chain. The gateway never
holds funds, never signs, and cannot fake a payment.

The privacy property comes from one line in the payment circuit:

```compact
assert(coin.value >= price as Uint<128>, "underpaid");
```

`price` is public. `coin.value` is private — it never leaves the agent's machine.

**Why a credit and not NIGHT directly.** NIGHT is an unshielded token, so spending it would
reveal the amount. The vault pools deposited NIGHT and mints a shielded credit against it
1:1. Deposits and withdrawals are public; every payment between them is private — the same
trade any shielded pool makes.

## Layout

| Path | Contents |
|---|---|
| `shared/` | Types imported by every package — registry row, 402 body, payment header |
| `contracts/` | `m402Vault.compact` — the vault: `registerService`, `deposit`, `pay`, `withdraw` |
| `gateway/` | Hono proxy, origin + relay adapters, indexer watcher |
| `agent/` | Agent CLI — `deposit` and `call` |
| `web/` | Marketplace and explorer |
| `docs/` | Design, platform constraints, stack, roadmap, diagrams |

## Docs

- [`docs/design.md`](docs/design.md) — architecture, contract, gateway, failure modes
- [`docs/constraints.md`](docs/constraints.md) — measured Midnight platform limits that shape the design
- [`docs/stack.md`](docs/stack.md) — tooling decisions and repo layout
- [`docs/roadmap.md`](docs/roadmap.md) — deferred scope and known limitations
- [`docs/architecture/payment-flow.md`](docs/architecture/payment-flow.md) — value lifecycle, sequence diagrams, trust boundaries

## Status

Hackathon build. Runs on Midnight **Preview**. Settlement is a vault-minted shielded credit
backed 1:1 by pooled NIGHT; prices are entered in USD and converted once at registration.

Known limitations are documented rather than hidden — see
[`docs/roadmap.md`](docs/roadmap.md#known-limitations).

## Requirements

- Node 22 or 24 (23 and 26 break the Midnight SDK's ESM resolution)
- Docker, for the local proof server on `:6300`
- Lace wallet, for merchant registration and withdrawal
- tNIGHT from the Preview faucet, to deposit against
