# m402

**Private agentic payments on Midnight.**

x402 lets AI agents pay for APIs and data in real time, but it runs on transparent chains.
Every payment is signed by an address, so an agent's entire spending history is public and
linkable: which services it uses, how often, in what order, alongside what else. That is its
strategy.

m402 implements the same 402-and-retry flow on Midnight. **Payments carry no payer.** Nobody
— not the merchant, not the gateway, not an observer — can tell which agent paid, or link two
payments to the same agent.

Prices stay public, because a marketplace needs a price list. What disappears is the identity
behind each call. See [what is and isn't private](docs/design.md#privacy).

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
       ▼                                         │    for the receipt
┌─────────────────────────────┐                  │
│   m402Vault.compact         │ ◄────────────────┘
│   receipts · balances       │                  │ 6. dispatch
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

The privacy property is that `pay` takes **no payer argument and reads no caller identity**.
It proves possession of a valid credit and nothing more:

```compact
assert(coin.color == tokenType(creditDomain(), kernel.self()), "not an m402 credit");
assert(coin.value == price as Uint<128>, "wrong amount");
```

An x402 payment on Base is a transfer *from an address*. An m402 payment is a proof that
*someone* holding a valid credit paid — with no address anywhere in it.

**Why a credit and not NIGHT directly.** NIGHT is an unshielded token, so spending it reveals
the sender. The vault pools deposited NIGHT and mints a shielded credit against it 1:1.
Deposits and redemptions are public; the payments between them are unlinkable — the same
trade any shielded pool makes.

## Using it from an agent

**Consuming a service needs no Midnight code.** The gateway speaks ordinary HTTP 402, so any
client in any language completes the exchange in two requests:

```
GET /s/<service-id>                     -> 402 {serviceId, price, vaultAddress}
GET /s/<service-id>  X-Payment: <hex>   -> 200 <the resource>
```

**Paying is the part worth a client.** Turning that `price` into a valid `X-Payment` secret
means building, proving and submitting a Midnight transaction, then holding the secret durably
until the resource actually arrives. The CLI does that, so `m402 call <url>` takes the same URL
`curl` would — it is a `curl` that knows how to pay:

```bash
m402 init                            # sync the wallet, report holdings; submits nothing
m402 deposit 5000                    # once: NIGHT -> shielded credit
m402 call https://gw.example/s/<id>  # per request, resource on stdout
m402 redeem 4500 --yes               # unspent credit -> NIGHT
```

stdout carries only the resource body, so it pipes; progress goes to stderr; exit codes
distinguish "retry" from "fix your config". Agents must serialize calls — one wallet cannot
submit two transactions at once.

Full integration notes, exit-code table and recovery semantics:
[`agent/README.md`](agent/README.md#using-m402-from-an-agent).

## Layout

| Path | Contents |
|---|---|
| `shared/` | Types imported by every package — registry row, 402 body, payment header |
| `contracts/` | `m402Vault.compact` — `registerService`, `deposit`, `pay`, `redeem`, `withdraw` |
| `gateway/` | Hono proxy, origin + relay adapters, indexer watcher |
| `agent/` | Agent CLI — `init`, `deposit`, `call`, `redeem` |
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
Agents can `redeem` unspent credit back to NIGHT at any time.

Known limitations are documented rather than hidden — see
[`docs/roadmap.md`](docs/roadmap.md#known-limitations).

## Requirements

- Node 22 or 24 (23 and 26 break the Midnight SDK's ESM resolution)
- Docker, for the local proof server on `:6300`
- Lace wallet, for merchant registration and withdrawal
- tNIGHT from the Preview faucet, to deposit against

## Credits

![The m402 team receiving the Open Track prize at Hack Buenos Aires](docs/media/hack-buenos-aires-winners.jpg)

**Open Track, 1st place — Hack Buenos Aires, 8 August 2026.**

Built by [Julián Ariel Martínez](https://www.linkedin.com/in/julianariel94/),
[Martín Lecam](https://www.linkedin.com/in/martin-guillermo-lecam/) and
[Sebastián Rosenberg](https://www.linkedin.com/in/sebastian-rosenberg/).

Thank you to [Midnight](https://midnight.network) and the Hack Buenos Aires organisers for
putting on the event, and to the Midnight team for being there through the weekend.

| | |
|---|---|
| Pitch video | [`docs/media/m402-pitch.mp4`](docs/media/m402-pitch.mp4) |
| Deck | [`docs/media/m402-pitch.pptx`](docs/media/m402-pitch.pptx) |
