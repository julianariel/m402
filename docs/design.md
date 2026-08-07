# Design

Technical design for m402. Platform limits referenced here are documented in
[`constraints.md`](constraints.md); deferred scope is in [`roadmap.md`](roadmap.md).

---

## 1. Model

An agent proves *"I am paying at least the asking price"* and something delivers a resource.
Two fulfilment paths share that single primitive:

- **origin** — proxy to a merchant's own HTTP API
- **relay** — pay an existing x402 service on an EVM chain in USDC and return the response

Relayed services are registered in the marketplace exactly like native ones, at a price
covering USDC cost plus margin. From the agent's side the two are indistinguishable. This is
what removes the need for a quote round-trip, a price oracle, and a refund path.

## 2. Request flow

1. Agent requests `GET /s/:id`
2. Gateway replies `402` with `{ serviceId, price, vaultAddress }`
3. Agent builds `pay()`, proves locally, submits to Midnight
4. Agent retries with header `X-Payment: <nullifier>`
5. Gateway watches the indexer for that nullifier against that `serviceId`
6. Gateway dispatches on `service.type` — proxy to origin, or relay to EVM
7. Resource returned verbatim
8. Merchant calls `withdraw()` at any time

The agent submits its own transaction. The gateway only reads the chain: it holds no funds,
signs nothing, and cannot fabricate a payment. Step 5 is a GraphQL-WS subscription against
the indexer.

## 3. Contract — `m402Vault.compact`

### Ledger state (public)

```compact
pragma language_version 0.23;

export ledger servicePrice:     Map<Bytes<32>, Uint<64>>;  // serviceId -> price in STAR
export ledger serviceOwner:     Map<Bytes<32>, Bytes<32>>; // serviceId -> merchant key
export ledger nullifiers:       Set<Bytes<32>>;            // spent payments
export ledger merchantBalance:  Map<Bytes<32>, Uint<64>>;  // claimable
```

No coin ever appears in ledger state. A `QualifiedShieldedCoinInfo` stored in a ledger cell
would publish its `value`, and consecutive pot totals would differ by exactly the amount
paid. The pot is held as private state instead; see
[`constraints.md`](constraints.md#a-contract-cannot-hold-a-coin-publicly).

### `registerService(serviceId, price, owner)`

Public write, no witness. Lists an endpoint. No signature required: registering a service
that pays someone else is a gift, and the security-critical step is withdrawal.

`owner` is the merchant's Zswap coin public key, taken from their Lace address.

### `pay(serviceId)`

The nullifier is derived inside the circuit rather than passed in, which is what makes
selective disclosure possible without a second circuit.

```compact
export circuit pay(serviceId: Bytes<32>): [] {
  assert(servicePrice.member(disclose(serviceId)), "unknown service");
  const price = servicePrice.lookup(disclose(serviceId));

  // The coin lives on the agent's machine. receiveShielded takes a coin, not an
  // amount; the amount is coin.value and it is never written publicly.
  const coin = paymentCoin();
  assert(coin.value >= price as Uint<128>, "underpaid");

  // Commits to the amount, so it doubles as the opening for selective disclosure.
  // coin.nonce is fresh per payment and private, which is what stops an observer
  // brute-forcing the amount out of the hash — the amount space is small.
  const nullifier = persistentHash<Vector<3, Bytes<32>>>(
    [coin.nonce, serviceId, coin.value as Bytes<32>]
  );
  assert(!nullifiers.member(disclose(nullifier)), "already spent");

  receiveShielded(disclose(coin));
  nullifiers.insert(disclose(nullifier));

  const owner = serviceOwner.lookup(disclose(serviceId));
  const prior = merchantBalance.member(owner) ? merchantBalance.lookup(owner) : 0 as Uint<64>;
  merchantBalance.insert(owner, (prior + price) as Uint<64>);
}
```

Public: `serviceId`, `price`, and the resulting `nullifier`. Private: `coin.value` and
`coin.nonce`. `disclose(coin)` on `receiveShielded` releases the coin *commitment* — a hash
— not the value.

The agent knows its own nullifier locally and sends it in `X-Payment` so the gateway can
match the request. It becomes public on-chain regardless.

### `withdraw(serviceId, amount)`

The payout destination is read from the ledger, and the circuit bounds the amount by the
recorded balance:

```compact
export circuit withdraw(serviceId: Bytes<32>, amount: Uint<64>): [] {
  assert(serviceOwner.member(disclose(serviceId)), "unknown service");
  const owner = serviceOwner.lookup(disclose(serviceId));

  assert(merchantBalance.member(owner), "no balance");
  const balance = merchantBalance.lookup(owner);
  assert(balance >= disclose(amount), "insufficient balance");

  const pot = vaultCoin();   // private state, not the ledger
  sendShielded(
    disclose(pot),
    left<ZswapCoinPublicKey, ContractAddress>(ZswapCoinPublicKey { bytes: owner }),
    disclose(amount) as Uint<128>
  );

  merchantBalance.insert(owner, (balance - disclose(amount)) as Uint<64>);
}
```

**The circuit does not authenticate its caller, because it does not need to.** Midnight has
no `msg.sender`, and `ownPublicKey()` is a witness the prover chooses, so caller
verification would require the merchant to hold a secret. Reading the destination from
`serviceOwner` removes the requirement entirely: whoever submits this transaction, the funds
reach the registered merchant and nobody else. There is nothing to steal, so there is
nothing to authenticate — and the merchant's identity stays their Lace address.

Zswap independently validates that the witnessed pot is a real contract-owned coin, so a
forged witness cannot mint value. The balance assert is what bounds the payout.

`sendShielded` returns a change coin that the caller must persist as the next `vaultCoin()`.
Two merchants withdrawing concurrently would race for the same pot; see
[roadmap](roadmap.md#known-limitations).

### Selective disclosure

Because the nullifier is `hash(coin.nonce, serviceId, coin.value)`, it is a commitment to the
payment. To disclose one payment, the payer sends `(nonce, serviceId, amount)` to an auditor
off-chain, encrypted to the auditor's public key. The auditor recomputes the hash and checks
it against the nullifier on the public ledger.

The auditor learns that one payment's amount and nothing else — no other payment, no
long-term secret, no balance. The public learns nothing at any point.

Aggregate proofs across many payments require bounded loops and are out of scope; see
[roadmap](roadmap.md).

### Implementation note

Every signature above is confirmed against compact 0.31.1 by compiling. The confirmed API,
including the traps that are easy to guess wrong, is recorded in
[`../contracts/README.md`](../contracts/README.md#confirmed-stdlib-signatures).

## 4. Settlement and pricing

Settlement is **shielded NIGHT**. There is no deposit step: the agent attaches shielded NIGHT
directly to `pay()`, so no mint, deposit, or exchange-rate circuit exists.

Prices are entered and displayed in **USD**, settled in **NIGHT**:

- the merchant enters a USD price at registration
- the gateway converts once, at registration, using a fixed rate, and stores STAR in
  `servicePrice`
- explorer and CLI show both: `0.01 USD · 500 STAR`

Converting at registration rather than per payment means no oracle and no staleness handling
on the payment path. The on-chain price is fixed in NIGHT; the USD figure drifts. USD display
keeps native and relayed services legible in one list, since external x402 services quote in
USDC.

## 5. Gateway

```
1. resolve serviceId from /s/:id
2. no X-Payment?  → 402 { serviceId, price, vaultAddress }
3. X-Payment?     → verify nullifier on-chain via indexer
4. dispatch on service.type:
     "origin" → HTTP proxy to merchant's URL
     "relay"  → x402 client → pay USDC → fetch
5. return the response body verbatim
```

Registry row, covering both paths:

```ts
{ id, price, owner, type: "origin" | "relay",
  target: string,        // origin: proxy here · relay: pay-and-fetch here
  chain?: string }       // CAIP-2, relay only, e.g. "eip155:8453"
```

Steps 1–3 and 5 are shared; step 4 is a two-branch switch.

`chain` is a CAIP-2 identifier and the relay handler selects a viem client from it. Base is
used for development because the x402 ecosystem is there; nothing in the design is
Base-specific.

## 6. Registration and explorer

Merchants connect Lace and sign `registerService` themselves, paying their own DUST.
Non-custodial end to end: the gateway never holds merchant keys, never submits on their
behalf, and holds no wallet of its own. Merchants need a Midnight wallet regardless in order
to `withdraw()`.

**Merchant identity is the Lace address.** `serviceOwner` stores the Zswap coin public key
extracted from it. There is no merchant secret and nothing for the merchant to save:
`withdraw` pays the address recorded at registration, so identity never has to be proven.

A dev CLI registers services directly from a headless wallet, for testing and automation.

`registerService` costs a proof. Registration UI is optimistic: return the URL immediately,
badge it `confirming…`, flip to `live` when the indexer sees it.

The explorer lists native and relayed services together, with relayed entries badged by
chain. Public: service name, price, call volume. Hidden: every payer and every amount.

## 7. Agent

A CLI wrapping one function: handle the 402, build and prove the payment, submit, retry with
the nullifier, return the resource. It reports proof-generation and verification timings
separately, since they differ by four orders of magnitude.

## 8. Failure modes

| Condition | Result |
|---|---|
| Agent underpays | `assert` fails, transaction rejected, nothing spent |
| Nullifier replayed | Rejected on-chain — one payment cannot buy two calls |
| Indexer lag after submit | Gateway polls with backoff, ~60s timeout |
| Origin down after payment lands | Agent paid, received nothing. No refund path. |
| Agent never retries after paying | Same — payment spent, merchant credited, no resource |
| External call fails after relayer paid USDC | Relayer absorbs the loss |

**Payment and delivery are not atomic.** This is the principal known weakness. Mitigation in
this version: the gateway health-checks the origin *before* returning the 402, so failures
occur before the agent spends rather than after. A refund circuit is the real fix and is
tracked in the [roadmap](roadmap.md).
