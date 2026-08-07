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
┌─────────────┐   1. GET /s/abc          ┌──────────────────────┐
│    Agent    │ ───────────────────────► │   m402 Gateway       │
│  (CLI/SDK)  │ ◄─────────────────────── │   proxy + verifier   │
└──────┬──────┘   2. 402 + requirements  └───────┬──────────────┘
       │                                         │
       │ 3. pay() tx                             │ 5. watch indexer
       ▼                                         │    for nullifier
┌─────────────────────────────┐                  │
│   m402Vault.compact         │ ◄────────────────┘
│   nullifiers · balances     │                  │ 6. dispatch
└─────────────────────────────┘                  ▼
       ▲                        ┌────────────────┴─────────────┐
       │ 8. withdraw            │  origin API    │  EVM relayer│
┌──────┴──────┐                 │  (marketplace) │  (x402 out) │
│  Merchant   │                 └──────────────────────────────┘
└─────────────┘
```

The agent submits its own transaction; the gateway only reads the chain. The gateway never
holds funds, never signs, and cannot fake a payment.

The privacy property comes from one line in the payment circuit:

```compact
assert(amount >= price, "underpaid");
```

`price` is public. `amount` is a witness — it never leaves the agent's machine.

## Layout

| Path | Contents |
|---|---|
| `contracts/` | `m402Vault.compact` — the vault, three circuits |
| `gateway/` | Proxy, origin + relay adapters, indexer watcher |
| `agent/` | Agent CLI and SDK |
| `web/` | Marketplace and explorer |
| `docs/` | Design, platform constraints, roadmap, diagrams |

## Docs

- [`docs/design.md`](docs/design.md) — architecture, contract, gateway, failure modes
- [`docs/constraints.md`](docs/constraints.md) — measured Midnight platform limits that shape the design
- [`docs/roadmap.md`](docs/roadmap.md) — deferred scope and known limitations
- [`docs/architecture/payment-flow.md`](docs/architecture/payment-flow.md) — sequence diagrams

## Status

Hackathon build. Runs on Midnight **Preview**. Settlement is shielded NIGHT; prices are
entered in USD and converted once at registration.

Known limitations are documented rather than hidden — see
[`docs/roadmap.md`](docs/roadmap.md#known-limitations).

## Requirements

- Node 22 or 24 (23 and 26 break the Midnight SDK's ESM resolution)
- Docker, for the local proof server on `:6300`
- Lace wallet, for merchant registration and withdrawal
