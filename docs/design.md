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

## Privacy

Precisely what m402 does and does not hide. Everything here was established by compiling, or
by an adversarial audit of the contract.

**Private — the payer.** `pay` takes no payer argument and reads no caller identity. It
proves possession of a valid credit coin and nothing else. No address appears in the
transaction, and two payments by the same agent cannot be linked to each other. This is the
property x402 on a transparent chain cannot have, and it is the whole point.

This is checked, not only argued. `puts no payer identity into a pay transaction` in
`deploy.test.ts` captures a real `pay` transaction at `balanceTx` and asserts that no intent
carries an unshielded offer or a DUST registration — either would bind the agent's public
NIGHT address to the payment. Both are reachable without a code change: a fee shortfall can
pull an unshielded UTXO into balancing, and a first-time DUST registration rides along.
Neither is loud, so the test is what keeps the claim true.

**Public — everything about the trade.** The service, its price, the merchant, the timing,
and a `merchantBalance` increment of exactly `price`. Deposits and redemptions are public in
both amount and address.

**The amount is not hidden, and cannot be.** `pay` consumes the whole credit coin, so the
wallet splits off a coin worth exactly `price` — which is published in `servicePrice`.
Returning change through the circuit does not help: the compiler reports that
`mintShieldedToken` *"might disclose the value of a token mint"*, so a change amount plus the
public price gives the original away. `assert(coin.value == price)` binds the coin to the
published price; it is a correctness check, not an amount-hiding mechanism.

**Privacy is bounded by the anonymity set.** A payment is unlinkable only among other
payments drawn from the pool. See [roadmap](roadmap.md#known-limitations).

## 2. Request flow

0. Agent calls `deposit()` once, converting NIGHT into shielded credits
1. Agent requests `GET /s/:id`
2. Gateway replies `402` with `{ serviceId, price, vaultAddress }`
3. Agent builds `pay()`, proves locally, submits to Midnight
4. Agent retries with header `X-Payment: <receiptSecret>`
5. Gateway hashes it, checks membership in the on-chain `receipts` set for that `serviceId`
6. Gateway dispatches on `service.type` — proxy to origin, or relay to EVM
7. Resource returned verbatim
8. Merchant calls `withdraw()` at any time

Step 0 is a one-time top-up, not part of the per-call path — it costs a proof, but it is
amortised over every call the deposit funds. Steps 1–7 are the per-call loop.

The agent submits its own transaction. The gateway only reads the chain: it holds no funds,
signs nothing, and cannot fabricate a payment. Step 5 subscribes to the vault's contract state
through the Midnight SDK's `PublicDataProvider` (`contractStateObservable`) and checks
`ledger(state.data).receipts.member(...)` on every emission — a typed SDK entry point, not a
hand-rolled GraphQL query against a guessed schema.

**Step 4 sends the receipt *secret*, never anything read off the chain.** Only
`deriveReceipt(secret, serviceId)` is published, so possession of the secret is what proves
the purchase. The gateway must also record consumed secrets locally — the on-chain set proves
a payment happened, never that it is still unspent. It also checks the secret's hash against
every *other* registered service's derived receipt, so a secret that paid for the wrong
service is reported as such rather than degrading into an indistinguishable timeout.

Diagrams for each step: [`architecture/payment-flow.md`](architecture/payment-flow.md).

## 3. Contract — `m402Vault.compact`

Five state circuits: `registerService`, `deposit`, `pay`, `redeem`, `withdraw`, plus three
**exported pure circuits** — `creditColor`, `deriveReceipt` and `deriveServiceId` — which
form the off-chain interface. They need no proof and no wallet, so the gateway, the web app
and an auditor call them through `pureCircuits` rather than reimplementing the hashes. Their
signatures are in [`../contracts/README.md`](../contracts/README.md), which also holds the
confirmed stdlib API and the witness requirements. All compile against compact 0.31.1.

### Ledger state (public)

```compact
export ledger servicePrice:    Map<Bytes<32>, Uint<64>>;  // serviceId -> price in STAR
export ledger serviceOwner:    Map<Bytes<32>, Bytes<32>>; // serviceId -> merchant UserAddress
export ledger receipts:        Set<Bytes<32>>;            // hashed redemption credentials
export ledger merchantBalance: Map<Bytes<32>, Uint<64>>;  // claimable
export ledger mintCounter:     Counter;                   // deposit nonce index
```

No coin appears in ledger state. A `QualifiedShieldedCoinInfo` in a ledger cell publishes its
`value`; see [`constraints.md`](constraints.md#a-contract-cannot-hold-a-coin-publicly).

### `registerService(salt, price, owner)`

```compact
export pure circuit deriveServiceId(
  owner: Bytes<32>,
  salt: Bytes<32>,
  price: Uint<64>
): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>(
    [pad(32, "m402:sid:v1"), owner, salt, price as Bytes<32>]
  );
}

export circuit registerService(salt: Bytes<32>, price: Uint<64>, owner: Bytes<32>): [] {
  assert(price > 0, "price must be positive");
  assert(owner != pad(32, ""), "owner must be set");
  const serviceId = deriveServiceId(disclose(owner), disclose(salt), disclose(price));
  assert(!servicePrice.member(serviceId), "already registered");
  assert(!serviceOwner.member(serviceId), "already registered");
  servicePrice.insert(serviceId, disclose(price));
  serviceOwner.insert(serviceId, disclose(owner));
}
```

**`serviceId` is derived from the owner and the price, not chosen freely.** A free
`serviceId` is front-runnable: an observer copies an in-flight registration, substitutes
their own `owner`, wins the race, and — because registration is immutable — permanently
collects that service's revenue. Deriving the id from `owner` means a substituted address
produces a *different* id and cannot collide. Both maps are guarded, so neither can be
replaced independently.

**`price` is bound for the same reason.** Every argument of a pending registration is public.
While the id bound only the owner, a front-runner could copy the victim's `owner` and `salt`,
set `price` to 1, and win the race — leaving the merchant with a service permanently priced
at 1. Binding `price` into the id closes that path: a substituted price yields a different id.

`deriveServiceId` is `pure`, so the gateway and web app compute the same id off-chain with no
proof. All three inputs are needed, `price` included. `owner` is the merchant's unshielded Lace address, used directly as the payout
destination.

### `deposit(amount)`

Unshielded NIGHT in, shielded credit out. Public by nature.

```compact
export circuit deposit(amount: Uint<64>): [] {
  assert(amount > 0, "amount must be positive");
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
misdirects their own deposit. It is never sound as a gate.

`mintCounter` is a public index, not entropy. **All of a payment's unlinkability rests on
`nonceSeed()`**, and a deterministic seed still produces distinct, non-colliding nonces — so
the failure is silent. See [witness requirements](../contracts/README.md#witness-requirements).

### `pay(serviceId)`

```compact
export circuit pay(serviceId: Bytes<32>): [] {
  const sid = disclose(serviceId);
  assert(servicePrice.member(sid), "unknown service");
  const price = servicePrice.lookup(sid);

  const coin = creditCoin(sid, price);
  assert(coin.color == tokenType(creditDomain(), kernel.self()), "not an m402 credit");
  // Not >=. pay consumes the WHOLE coin but credits only price, so an overpaying
  // coin burns the difference into NIGHT no circuit can release.
  assert(coin.value == price as Uint<128>, "wrong amount");

  const receipt = deriveReceipt(receiptSecret(), sid);
  assert(!receipts.member(disclose(receipt)), "receipt reused");

  receiveShielded(disclose(coin));
  receipts.insert(disclose(receipt));

  const owner = serviceOwner.lookup(sid);
  const prior = merchantBalance.member(owner) ? merchantBalance.lookup(owner) : 0 as Uint<64>;
  merchantBalance.insert(owner, (prior + price) as Uint<64>);
}
```

Three things here are load-bearing.

**The colour assert.** `receiveShielded` does not check what token it receives. Without this,
an attacker mints their own worthless shielded token and buys API calls with it. Contract
token colours are collision-resistant, so only this vault can mint that colour.

**The receipt is the credential, and only its hash is public.** `receipts` holds
`deriveReceipt(secret, serviceId)`; the payer keeps the secret and presents it to the
gateway. Publishing the credential itself would let anyone watching the indexer claim the
resource before the honest agent retried, and replay it forever.

**There is no nullifier.** Zswap already prevents spending the same coin twice, so a
contract-level nullifier would guard nothing while costing a set write in the hottest
circuit, growing without bound, and risking rejection of an honest payment on a nonce
collision. The only secret it could key on is a coin nonce, which is public for a
deposit-minted coin — so a `creditCoin` that reused one would make every payment
recomputable from public data, silently.

**`creditCoin` is parameterised.** `pay` consumes the whole coin, so the wallet must supply
one worth exactly `price`. A zero-argument witness could not know the price and would return
the agent's largest coin, silently stranding the remainder.

### `redeem(recipient)`

Cash unspent credit back to NIGHT, so an agent that over-funded is not stuck.

```compact
export circuit redeem(recipient: Bytes<32>): [] {
  assert(recipient != pad(32, ""), "recipient must be set");
  const coin = redeemCoin();
  assert(coin.color == tokenType(creditDomain(), kernel.self()), "not an m402 credit");
  assert(coin.value > 0, "nothing to redeem");

  receiveShielded(disclose(coin));
  sendUnshielded(
    nativeToken(), disclose(coin.value),
    right<ContractAddress, UserAddress>(UserAddress { bytes: disclose(recipient) })
  );
}
```

No authentication: holding the coin *is* the authorisation, since Zswap validates the spend.
The caller may therefore name any destination — it is their own money. Redeeming is public in
both amount and address, like depositing.

### `withdraw(serviceId, amount)`

```compact
export circuit withdraw(serviceId: Bytes<32>, amount: Uint<64>): [] {
  const sid = disclose(serviceId);
  assert(amount > 0, "amount must be positive");
  assert(serviceOwner.member(sid), "unknown service");
  const owner = serviceOwner.lookup(sid);

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

**No caller authentication, deliberately.** Midnight has no `msg.sender`, and
`ownPublicKey()` is a witness the prover chooses, so verifying the caller would cost the
merchant a secret to safeguard. Reading the destination from `serviceOwner` removes the
requirement: whoever submits this, the funds reach the registered merchant.

The residual is griefing, not theft — anyone can *trigger* a merchant's payout. `amount > 0`
rejects the zero-value no-op, which would otherwise be a free way to contend on
`merchantBalance` and fail concurrent payments to that merchant.

### Selective disclosure

`receipts` holds `hash("m402:receipt:v1", secret, serviceId)`. To prove one purchase to an
auditor, the payer hands over that payment's secret; the auditor recomputes the hash and
checks membership on the public ledger. It proves *this payment, to this service, by me* and
reveals nothing about any other payment.

`deriveReceipt` is exported and pure, so an auditor verifies an opening with no proof and no
reimplementation of the hash:

```ts
const opening = pureCircuits.deriveReceipt(secret, serviceId);
const proven  = ledger(state.data).receipts.member(opening);
```

### Solvency

`merchantBalance` can only be credited by `pay`, which requires receiving real m402-coloured
credit; that credit can only exist via `deposit`, which requires an equal amount of NIGHT.
`withdraw` and `redeem` decrement both sides together. Outstanding claims can therefore never
exceed the pooled reserve.

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
1. resolve serviceId from /s/:id — unknown → 404
2. no X-Payment?  → origin service: health-check first, unreachable → 503
                  → 402 { serviceId, price, vaultAddress }
3. X-Payment?     → hash the secret via deriveReceipt(secret, serviceId),
                    check the on-chain receipts set, then the locally-consumed set
                    → confirmed     → continue to 4
                    → replayed      → 402 { reason: 'receipt-already-used' }
                    → wrong-service → 402 (payment body — secret paid a different service)
                    → timeout       → 503 { reason: 'payment-pending' }, Retry-After
4. dispatch on service.type:
     "origin" → HTTP proxy to merchant's URL
     "relay"  → x402 client → pay USDC → fetch
5. return the response body verbatim
```

`POST /services` registers a service in the gateway's own registry — a plain HTTP write, not
something synced automatically from the chain. Before accepting one, the gateway reads
`serviceOwner[id]` from the chain and compares it to the claimed `owner`:

```
not yet visible on-chain → 503 { reason: 'registration-not-yet-confirmed' }  (retryable)
owner mismatch           → 403 { reason: 'owner-mismatch' }                  (not retryable)
match                    → inserted
```

Registry row, covering both paths:

```ts
{ id, price, owner, type: "origin" | "relay",
  target: string,        // origin: proxy here · relay: pay-and-fetch here
  chain?: string }       // CAIP-2, relay only — "eip155:8453" or "eip155:84532"
```

Steps 1–3 and 5 are shared; step 4 is a two-branch switch.

`chain` is a CAIP-2 identifier, and the relay handler registers an x402 payment scheme for
exactly that network — never a wildcard, so a service cannot induce a payment on a chain it
did not declare. Base is used because that is where the x402 ecosystem is; nothing in the
design is Base-specific.

## 6. Registration and explorer

Merchants connect Lace and sign `registerService` themselves, paying their own DUST.
Non-custodial end to end: the gateway never holds merchant keys, never submits on their
behalf, and holds no wallet of its own. Merchants need a Midnight wallet regardless in order
to `withdraw()`.

**Merchant identity is the Lace address.** `serviceOwner` stores the merchant's unshielded
address bytes, which `sendUnshielded` takes directly as a `UserAddress`. There is no merchant
secret and nothing to save: `withdraw` pays the address recorded at registration, so identity
never has to be proven.

`serviceId` is derived (`deriveServiceId(owner, salt, price)`, §3), not chosen freely — `salt`
is the 32 random bytes generated in the publish form. On-chain the id is only a key; the URL
lives in the gateway's registry. Registration is first-come and immutable — `Map.insert`
overwrites, so without that guard anyone could re-register a `serviceId` with themselves as
owner and redirect the merchant's revenue.

Headless registration exists as a library function, not as a command: `contracts/src/client.ts`
exports `registerService`, which `deploy.test.ts` calls against a real Preview vault. The web
UI is the only registration surface an operator has.

`registerService` costs a proof, and `POST /services` to the gateway's own registry is a
**separate** call the web UI makes after it — the contract never stores the URL. The gateway
does not accept that call on faith: it reads `serviceOwner[id]` from the chain and rejects
with `503` if the registration isn't visible yet (retry once it lands), or `403` if the
claimed owner doesn't match what's on-chain. A gateway registry entry therefore only exists
once the chain has already confirmed it, so there is no unconfirmed state for the UI to badge.

The explorer lists native and relayed services together, with relayed entries badged by
chain. Public: service name, price, call volume. Hidden: every payer and every amount.

## 7. Agent

A CLI wrapping four commands: `init`, `deposit`, `call`, `redeem`.

`m402 init` syncs the wallet and reports what it holds. It submits nothing. Running it first
moves the one-off multi-minute sync out of the first payment.

`m402 deposit <amount>` converts NIGHT into shielded credits and persists the returned credit
coin. Run once per top-up; one deposit funds many calls, because the wallet splits a larger
coin and keeps the change.

`m402 call <url>` is the per-call loop: handle the 402, build and prove the payment, submit,
retry with the receipt secret, return the resource. It reports proof-generation and verification
timings separately, since they differ by four orders of magnitude, and it labels deposit cost
distinctly so a one-off top-up is not mistaken for per-call latency.

`m402 redeem <amount>` returns unspent credit to NIGHT, so an agent that over-funded is not
stuck. The receipt secret is written to the agent's state file before the transaction is
submitted, so a crash between paying and claiming is recoverable.

## 8. Failure modes

| Condition | Result |
|---|---|
| Agent underpays | `assert` fails, transaction rejected, nothing spent |
| Agent over-funds and stops | `redeem` returns the unspent credit as NIGHT |
| Observer copies a receipt hash from the chain | Useless — redemption needs the secret, which is never published |
| Agent pays more than the price | Rejected — `coin.value == price`, so an overpaying coin cannot burn the difference |
| Two payments submitted concurrently | One fails. Writes to a contract conflict contract-wide; see [roadmap](roadmap.md#known-limitations) |
| Registration front-run | `serviceId` is derived from `owner`, so a substituted address yields a different id |
| Agent pays with a foreign token | Colour assert fails — only vault-minted credits are accepted |
| `serviceId` re-registered | Rejected on-chain — registration is first-come and immutable |
| Agent loses its credit coin | Unrecoverable — `redeem` needs the coin |
| Deposit tx lacks the NIGHT input | `receiveUnshielded` fails at submit — nothing minted |
| Indexer lag after submit | Gateway polls with backoff, ~60s timeout |
| Origin down after payment lands | Agent paid, received nothing. No refund path. |
| Agent never retries after paying | Same — payment spent, merchant credited, no resource |
| External call fails after relayer paid USDC | Relayer absorbs the loss |

**Payment and delivery are not atomic.** This is the principal known weakness. Mitigation in
this version: the gateway health-checks the origin *before* returning the 402, so failures
occur before the agent spends rather than after. A refund circuit is the real fix and is
tracked in the [roadmap](roadmap.md).
