# Roadmap

Scope deliberately deferred, with the reasoning and what each would take. Known limitations
of the current build are listed at the end.

---

## Amortised proof generation

Every API call currently generates a fresh proof, so the agent waits ~19s. Verification is
~3.4ms — generation is the entire cost.

**Approach.** Chaumian e-cash. The agent deposits once and the vault issues
fixed-denomination notes. The wallet proves notes in the background while idle, keeping a
buffer of spend-ready notes. At call time it presents an already-proven note and a nullifier.
Per-call latency drops to the verification cost with no loss of privacy — every call still
carries a real proof.

**Cost.** Note denomination logic, buffer refill management, a larger nullifier set. One
additional circuit and a wallet change.

## Arbitrary-URL relaying

Relayable external x402 services are currently curated: each is registered like any other
service at a fixed price. Agents choose from a list.

**Approach.** Allow an agent to point the relayer at any x402 URL discovered at runtime.
Requires a `/quote` endpoint — the relayer probes the external service, reads the price from
its 402 response, converts to NIGHT, and returns a signed quote — plus a **refund circuit**,
since quotes can go stale and calls can fail.

## Atomic payment and delivery

Payment and delivery are separate steps. If an origin fails after a payment lands, the agent
has spent without receiving anything. The gateway health-checks origins before returning a
402, which narrows the window but does not close it.

**Approach.** The same refund circuit that arbitrary-URL relaying needs: return the unspent
amount to the payer when delivery fails. One circuit unlocks both features.

## Private merchant volume

`merchantBalance` increases by a public `price`, so call volume per service is observable.
Payers and amounts are not.

**Approach.** Store merchant balances as commitments and settle with a proof at withdrawal
rather than incrementing a public integer.

## Stablecoin settlement

Settlement is shielded NIGHT. Prices are entered in USD and converted once at registration
using a fixed rate, so the displayed USD value drifts.

**Approach.** Settle in a Midnight-native USD stablecoin — [ShieldUSD](https://midnight.network/ecosystem-catalog)
is being built for exactly this class of use case, with confidentiality and selective
disclosure as design goals. Prices and settlement would both be USD-denominated, removing
conversion entirely.

A contract-minted credit token was considered instead. It was rejected because this design
has no deposit step: credits would require mint, deposit, and exchange-rate circuits.

## Live price feed

USD → NIGHT conversion uses a fixed rate applied at registration.

**Approach.** An oracle consulted at payment time, or stablecoin settlement (above), which
removes the conversion. An oracle on the payment path adds staleness handling and a failure
mode to the most critical flow.

## Merchant onboarding without Lace

Merchants must connect Lace to register. This keeps the gateway a pure read-and-proxy service
with no wallet and no DUST of its own, and merchants need a Midnight wallet regardless in
order to withdraw.

**Approach.** A gateway-sponsored registration path where the gateway pays DUST and the
merchant address remains the owner. Still non-custodial — withdrawal always requires proving
ownership.

## Middleware instead of a proxy

Merchants currently register a URL and traffic is proxied. This requires no code changes on
their side and works with any language or stack.

**Approach.** Ship an Express/Hono middleware so merchants can run the 402 handshake
themselves and keep the gateway out of their data path.

## Trustless EVM settlement

The relayer holds USDC and fronts payments to external x402 services, reimbursed from the
vault. It is a trusted operator.

**Approach.** Verify a Midnight proof on the EVM side so no operator can withhold the float
or censor a request. Verifying Halo2 proofs on EVM is a research problem; Midnight's own
roadmap places a trustless ZK bridge well beyond mainnet.

## Aggregate disclosure

Disclosure is per-payment: the payer reveals one payment's opening to an auditor, who checks
it against the on-chain commitment.

**Approach.** Prove aggregate properties over many hidden payments without revealing any of
them — *"every fee paid this period was at the correct rate"*, *"total spend with this
merchant is under a threshold"*. Requires bounded loops over a fixed-size array in Compact.

## Decentralised gateways and batching

The gateway is a single operator and settles one payment per call. Running multiple competing
gateways, and batching high-frequency micropayments, are both inherited from x402's own
roadmap.

---

## Known limitations

Current, deliberate, and documented:

- **Merchant call volume is public.** Payers and amounts are not.
- **Payment and delivery are not atomic.** No refund path exists yet.
- **The relayer is a trusted operator** for its USDC float.
- **Funding events are visible.** The payment graph is private; the fact that an agent
  acquired NIGHT is not.
- **Network metadata is out of scope.** The gateway observes IP addresses and timing. m402
  addresses protocol-level privacy: agents authenticate with a proof rather than an account,
  so the gateway never learns who is paying or how much.
- **Relayable services are curated**, not arbitrary.
