# Roadmap

Scope deliberately deferred, with the reasoning and what each would take. Known limitations
of the current build are listed at the end.

---

## Amortised proof generation

Every API call generates a fresh proof. Proving `pay` is seconds and the whole
prove-submit-confirm cycle is tens of seconds ([constraints](constraints.md#proving-cost));
verification is ~3.4ms. Generation is the entire cost.

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

## A larger anonymity set

Payments are unlinkable only among other payments in the pool, and the pool is small.

**Approach.** A deposit queue that batches several agents' funding into one transaction, and
a wallet default that deposits well above the immediate need so deposit sizes stop
correlating with spending. The Chaumian e-cash work above helps too, by decoupling the timing
of proving from the timing of spending.

## Protocol fees

m402 currently takes **no fee**. Every unit deposited is redeemable or spendable at par, and
merchants receive the full `price`. That keeps the demo's accounting trivially auditable, and
the solvency invariant is a plain equality rather than an equality minus a rake.

The relayer path is the exception and already earns: relayed services are listed at a price
covering USDC cost **plus margin**, so the spread exists there today.

**Approach.** Three places a fee could sit, in increasing intrusiveness:

1. **A spread on `redeem`** — cash out at 99%. One `assert` and one arithmetic line, touches
   neither the payment path nor its proving time, and cannot be avoided by an agent that
   wants its NIGHT back. Cheapest to add.
2. **A cut of each payment** — `merchantBalance += price - fee`, `protocolBalance += fee`.
   Most legible as a business model, but it adds a public ledger write to the hottest and
   most proof-expensive circuit.
3. **A deposit spread** — mint 99 credits per 100 NIGHT. Simple, but it prices the on-ramp,
   which is exactly the friction a new agent feels first.

Option 1 for a first cut. Whichever is chosen, the fee must be a ledger field set at
deployment rather than a compile-time constant, or changing it means redeploying and
migrating every registered service.

## Private merchant volume

`merchantBalance` increases by a public `price`, so call volume per service is observable.
Payers are not.

**Approach.** Store merchant balances as commitments and settle with a proof at withdrawal
rather than incrementing a public integer.

## Stablecoin settlement

Settlement is a vault-minted shielded credit backed by pooled NIGHT. Prices are entered in
USD and converted once at registration using a fixed rate, so the displayed USD value drifts.

**Approach.** Settle in a Midnight-native USD stablecoin — [ShieldUSD](https://midnight.network/ecosystem-catalog)
is being built for exactly this class of use case, with confidentiality and selective
disclosure as design goals. Prices and settlement would both be USD-denominated, removing
conversion entirely.

A contract-minted credit token is what the vault already uses, because NIGHT is unshielded
and cannot be the private payment asset. A stablecoin would replace it, removing the deposit
step and the USD conversion together.

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

- **Merchant call volume is public.** Payers are not.
- **The amount paid is public**, because it equals the published `price`. m402 hides who
  paid, not how much. A shielded amount cannot be returned as change — see
  [constraints](constraints.md#a-shielded-amount-cannot-be-returned-as-change).
- **Concurrent throughput is unmeasured.** A security review argued that writes to a
  contract conflict contract-wide rather than per key, which would cap a vault at about one
  transaction per block. It stays unmeasured because one wallet cannot submit two
  transactions at once — the node rejects the second at the DUST layer, before the contract
  runs, so nothing about contract contention is observable from a single-wallet harness.
  Measuring it needs a second funded Preview wallet. See
  [constraints](constraints.md#one-wallet-cannot-submit-two-transactions-concurrently).

  `pay` also does a read-modify-write on `merchantBalance[owner]`, which conflicts per
  merchant regardless of how coarse the platform's detection turns out to be.
  `Map<Bytes<32>, Counter>` would remove that, and batching — already on this roadmap and
  inherited from x402's own — is the general fix.
- **A DUST spend may be linkable to the address that registered the NIGHT.** DUST is
  shielded, but it is generated by *registered* NIGHT tied to a public address. We have not
  established whether a spend can be traced back to that address. If it can, `pay` is not
  anonymous regardless of what the contract does. The privacy claim should be read as
  unproven on this point until someone settles it.
- **Deposit and redemption amounts reveal total spend.** An observer sees address A deposit
  D and later redeem R, so A spent D−R. Every `servicePrice` is public, so with few services
  the set of payments summing to D−R is often unique — recovering *which* services A bought
  from public data alone. Mitigations are agent-side: deposit round amounts unrelated to any
  price, deposit well before paying, do not redeem the exact remainder, and never redeem to
  the deposit address.
- **Payment and delivery are not atomic.** No refund path exists yet.
- **The relayer is a trusted operator** for its USDC float.
- **Withdrawal can be triggered by anyone.** The payout destination is read from the ledger,
  so this cannot steal — the funds always reach the registered merchant's Lace address.
  Closing it would mean caller authentication, which on Midnight costs the merchant a secret
  to safeguard; not worth the trade.
- **Deposits and withdrawals are public**, in amount and in address. Only the payments
  between them are private. This is inherent to backing a shielded credit with an unshielded
  reserve, and is the same trade a shielded pool makes everywhere.
- **Privacy is bounded by the anonymity set.** An individual payment is unlinkable only among
  the other payments drawn from the pool. With one depositor and a handful of calls, an
  observer correlates a public deposit with the receipts that follow it, by amount and by
  timing — separate transactions are not enough on their own. This is a property of usage
  rather than of the contract, and it is the same caveat every shielded pool carries.

  Three things raise it, none of which need code: deposit **round amounts** well above any
  single price, deposit **ahead of time** rather than immediately before spending, and have
  **more than one agent** funding the pool. Deposit and payment must never share a
  transaction — that would bind amount, payer and receipt into one public record and make
  the proof pointless.
- **Network metadata is out of scope.** The gateway observes IP addresses and timing. m402
  addresses protocol-level privacy: agents authenticate with a proof rather than an account,
  so the gateway never learns who is paying or how much.
- **Relayable services are curated**, not arbitrary.
- **Losing a receipt secret loses the purchase.** Only `hash(secret, serviceId)` reaches the
  chain, so the secret is the *only* proof a payment happened. The CLI writes it to
  `agent/.state/<network>.json` (mode `600`) *before* the transaction is submitted, so a crash
  between paying and claiming is recoverable and the next `call` resumes it. The file is still
  a single unreplicated copy on one machine: delete it and the paid-for call cannot be
  claimed. A real deployment needs it backed up.
- **Registration is not optimistic.** `POST /services` to the gateway's registry checks
  `serviceOwner[id]` on-chain before accepting the write, and rejects with a retryable `503`
  until the `registerService` transaction is visible. This closes the gap where a client could
  claim ownership the chain never granted, but it means the merchant UI cannot show the
  service URL immediately — it has to poll/retry through the confirmation window (same order
  of magnitude as a proof: ~20-30s) rather than badging an unconfirmed state as "live" early.
- **A secret paid for the wrong service degrades to a timeout, sometimes.** The gateway
  detects this case (`wrong-service`) only against services it already knows about at the
  moment `verify()` starts — a service registered *during* the wait window won't be in that
  precomputed candidate set, so a secret paid against it would still time out rather than
  return the more specific result.
