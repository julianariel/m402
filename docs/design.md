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

0. Agent calls `deposit()` once, converting NIGHT into shielded credits
1. Agent requests `GET /s/:id`
2. Gateway replies `402` with `{ serviceId, price, vaultAddress }`
3. Agent builds `pay()`, proves locally, submits to Midnight
4. Agent retries with header `X-Payment: <nullifier>`
5. Gateway watches the indexer for that nullifier against that `serviceId`
6. Gateway dispatches on `service.type` — proxy to origin, or relay to EVM
7. Resource returned verbatim
8. Merchant calls `withdraw()` at any time

Step 0 is a one-time top-up, not part of the per-call path — it costs a proof, but it is
amortised over every call the deposit funds. Steps 1–7 are the per-call loop.

The agent submits its own transaction. The gateway only reads the chain: it holds no funds,
signs nothing, and cannot fabricate a payment. Step 5 is a GraphQL-WS subscription against
the indexer.

Diagrams for each step: [`architecture/payment-flow.md`](architecture/payment-flow.md).

## 3. Contract — `m402Vault.compact`

Four circuits: `registerService`, `deposit`, `pay`, `withdraw`. All compile against compact
0.31.1; the confirmed stdlib API is in
[`../contracts/README.md`](../contracts/README.md#confirmed-stdlib-signatures).

### Ledger state (public)

```compact
export ledger servicePrice:    Map<Bytes<32>, Uint<64>>;  // serviceId -> price in STAR
export ledger serviceOwner:    Map<Bytes<32>, Bytes<32>>; // serviceId -> merchant UserAddress
export ledger nullifiers:      Set<Bytes<32>>;            // spent payments
export ledger merchantBalance: Map<Bytes<32>, Uint<64>>;  // claimable
export ledger mintCounter:     Counter;                   // deposit nonce source
```

No coin appears in ledger state. A `QualifiedShieldedCoinInfo` in a ledger cell publishes its
`value`, and consecutive totals would differ by exactly the amount paid; see
[`constraints.md`](constraints.md#a-contract-cannot-hold-a-coin-publicly).

### `registerService(serviceId, price, owner)`

```compact
export circuit registerService(serviceId: Bytes<32>, price: Uint<64>, owner: Bytes<32>): [] {
  assert(!servicePrice.member(disclose(serviceId)), "already registered");
  servicePrice.insert(disclose(serviceId), disclose(price));
  serviceOwner.insert(disclose(serviceId), disclose(owner));
}
```

`serviceId` is 32 random bytes chosen by the publisher. It is only a key on-chain — the URL
lives in the gateway's off-chain registry.

**The guard is security-critical.** `Map.insert` overwrites, so without it anyone could
re-register an existing `serviceId` with themselves as `owner` and redirect the merchant's
revenue. Registration is first-come and immutable.

`owner` is the merchant's unshielded Lace address, used directly as the payout destination.

### `deposit(amount)`

Unshielded NIGHT in, shielded credits out. Public by nature — see
[settlement](#4-settlement-and-pricing).

```compact
export circuit deposit(amount: Uint<64>): [] {
  receiveUnshielded(nativeToken(), disclose(amount) as Uint<128>);

  const nonce = disclose(evolveNonce(mintCounter as Field as Uint<64>, nonceSeed()));
  const coin = mintShieldedToken(
    creditDomain(), disclose(amount), nonce,
    right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );
  sendImmediateShielded(
    coin, left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()), coin.value
  );
  mintCounter.increment(1);
}
```

`ownPublicKey()` is sound here: it routes value *to* the caller, and a caller who lies only
misdirects their own deposit.

### `pay(serviceId)`

The nullifier is derived inside the circuit rather than passed in, which is what makes
selective disclosure possible without a second circuit.

```compact
export circuit pay(serviceId: Bytes<32>): [] {
  assert(servicePrice.member(disclose(serviceId)), "unknown service");
  const price = servicePrice.lookup(disclose(serviceId));

  const coin = creditCoin();
  // Without this the agent could mint a worthless token and pay with it.
  assert(coin.color == tokenType(creditDomain(), kernel.self()), "not an m402 credit");
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
`coin.nonce`. `disclose(coin)` on `receiveShielded` releases the coin *commitment* — a hash —
not the value. `merchantBalance` moves by the public `price`, never by what was actually paid.

The colour assert is load-bearing. Contract token colours are collision-resistant, so only
this vault can mint that colour; without the check any minted token would buy API calls.

The agent knows its own nullifier locally and sends it in `X-Payment` so the gateway can match
the request. It becomes public on-chain regardless.

### `withdraw(serviceId, amount)`

```compact
export circuit withdraw(serviceId: Bytes<32>, amount: Uint<64>): [] {
  assert(serviceOwner.member(disclose(serviceId)), "unknown service");
  const owner = serviceOwner.lookup(disclose(serviceId));

  assert(merchantBalance.member(owner), "no balance");
  const balance = merchantBalance.lookup(owner);
  assert(balance >= disclose(amount), "insufficient balance");

  sendUnshielded(
    nativeToken(), disclose(amount) as Uint<128>,
    right<ContractAddress, UserAddress>(UserAddress { bytes: owner })
  );

  merchantBalance.insert(owner, (balance - disclose(amount)) as Uint<64>);
}
```

**The circuit does not authenticate its caller, because it does not need to.** Midnight has no
`msg.sender`, and `ownPublicKey()` is a witness the prover chooses, so caller verification
would require the merchant to hold a secret. Reading the destination from `serviceOwner`
removes the requirement: whoever submits this, the funds reach the registered merchant and
nobody else. Nothing to steal, so nothing to authenticate — and merchant identity stays a Lace
address.

Paying out unshielded NIGHT means no pot coin, no change coin to persist, and no race between
merchants.

### Selective disclosure

Because the nullifier is `hash(coin.nonce, serviceId, coin.value)`, it is a commitment to the
payment. To disclose one payment, the payer sends `(nonce, serviceId, amount)` to an auditor
off-chain, encrypted to the auditor's public key. The auditor recomputes the hash and checks it
against the nullifier on the public ledger.

The auditor learns that one payment's amount and nothing else — no other payment, no long-term
secret, no balance. The public learns nothing at any point.

Aggregate proofs across many payments require bounded loops and are out of scope; see
[roadmap](roadmap.md).

## 4. Settlement and pricing

**NIGHT is an unshielded token**, so it cannot itself be the private payment asset — see
[`constraints.md`](constraints.md#night-is-unshielded). The vault pools deposited NIGHT and
issues a **shielded credit** against it 1:1.

- `deposit(amount)` — unshielded NIGHT in, shielded credits out. **Public.**
- `pay(serviceId)` — spend credits. **Private.**
- `withdraw(serviceId, amount)` — real NIGHT to the merchant. **Public.**

Deposits and withdrawals are visible; the payments between them are not. The pool's NIGHT
balance moves only on deposit and withdrawal, never on payment, so no payment amount can be
recovered by differencing it.

Credits are denominated in STAR, one-for-one with the NIGHT backing them, so a price stored
in `servicePrice` means the same amount of value whichever side of the deposit you are on.

Prices are entered and displayed in **USD**, settled in **credits**:

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

**Merchant identity is the Lace address.** `serviceOwner` stores the merchant's unshielded
address bytes, which `sendUnshielded` takes directly as a `UserAddress`. There is no merchant
secret and nothing to save: `withdraw` pays the address recorded at registration, so identity
never has to be proven.

`serviceId` is 32 random bytes generated in the publish form. On-chain it is only a key; the
URL lives in the gateway's registry. Registration is first-come and immutable — `Map.insert`
overwrites, so without that guard anyone could re-register a `serviceId` with themselves as
owner and redirect the merchant's revenue.

A dev CLI registers services directly from a headless wallet, for testing and automation.

`registerService` costs a proof. Registration UI is optimistic: return the URL immediately,
badge it `confirming…`, flip to `live` when the indexer sees it.

The explorer lists native and relayed services together, with relayed entries badged by
chain. Public: service name, price, call volume. Hidden: every payer and every amount.

## 7. Agent

A CLI wrapping two commands.

`m402 deposit <amount>` converts NIGHT into shielded credits and persists the returned credit
coin. Run once per top-up. Losing the coin loses the deposit — there is no redeem path.

`m402 call <url>` is the per-call loop: handle the 402, build and prove the payment, submit,
retry with the nullifier, return the resource. It reports proof-generation and verification
timings separately, since they differ by four orders of magnitude, and it labels deposit cost
distinctly so a one-off top-up is not mistaken for per-call latency.

## 8. Failure modes

| Condition | Result |
|---|---|
| Agent underpays | `assert` fails, transaction rejected, nothing spent |
| Agent pays with a foreign token | Colour assert fails — only vault-minted credits are accepted |
| Nullifier replayed | Rejected on-chain — one payment cannot buy two calls |
| `serviceId` re-registered | Rejected on-chain — registration is first-come and immutable |
| Agent loses its credit coin | Deposit unrecoverable. No redeem path; only merchants withdraw |
| Deposit tx lacks the NIGHT input | `receiveUnshielded` fails at submit — nothing minted |
| Indexer lag after submit | Gateway polls with backoff, ~60s timeout |
| Origin down after payment lands | Agent paid, received nothing. No refund path. |
| Agent never retries after paying | Same — payment spent, merchant credited, no resource |
| External call fails after relayer paid USDC | Relayer absorbs the loss |

**Payment and delivery are not atomic.** This is the principal known weakness. Mitigation in
this version: the gateway health-checks the origin *before* returning the 402, so failures
occur before the agent spends rather than after. A refund circuit is the real fix and is
tracked in the [roadmap](roadmap.md).
