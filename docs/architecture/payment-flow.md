# Flow diagrams

Sequence and boundary diagrams for each operation. The contract they describe is
[`../../contracts/src/m402Vault.compact`](../../contracts/src/m402Vault.compact); the
reasoning behind the shapes is in [`../design.md`](../design.md).

## Value lifecycle

Where money enters, moves, and leaves. **NIGHT is unshielded**, so spending it reveals the
sender — the vault pools it and issues a shielded credit against it 1:1. The payer is
anonymous only in the middle step.

```mermaid
flowchart LR
    subgraph pub1["public"]
        night["Agent's NIGHT"]
    end

    subgraph priv["private — the only shielded hop"]
        credit["shielded credit"]
        pay["pay() × N"]
    end

    subgraph pub2["public"]
        bal["merchantBalance<br/>+= price"]
        out["Merchant's NIGHT"]
    end

    night -->|"deposit()"| credit
    credit --> pay
    credit -->|"redeem()"| night
    pay --> bal
    bal -->|"withdraw()"| out

    pool[("pooled NIGHT<br/>reserve")]
    night -.->|backs| pool
    pool -.->|backs| out
```

Deposits and redemptions are signed by an address; payments are not. An agent's NIGHT going
in and a merchant's NIGHT coming out are both public — what is unlinkable is which agent
triggered which call in between.

## Deposit

Once per top-up, not per call. Unshielded NIGHT in, shielded credit out.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant W as Wallet
    participant V as m402Vault

    A->>W: deposit(amount)
    W->>V: tx carrying unshielded NIGHT
    V->>V: receiveUnshielded(nativeToken(), amount)
    V->>V: nonce = evolveNonce(mintCounter, seed)
    V->>V: mintShieldedToken(credit, amount, nonce)
    V-->>A: sendImmediateShielded → caller
    Note over A,V: amount and address are public here —<br/>and only here

    A->>A: persist the credit coin
    Note over A: lose it and the deposit is unrecoverable
```

Merchants use Lace; the agent CLI uses a headless wallet. Both take this same path.

## Redeem

The reverse of deposit: burn credit, get NIGHT back. Holding the coin is the authorisation.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant V as m402Vault

    A->>V: redeem(recipient)
    V->>V: assert colour == m402 credit
    V->>V: receiveShielded(coin)
    V-->>A: sendUnshielded(NIGHT) → recipient
    Note over A,V: public, like deposit
```

## Payment — native service

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant G as Gateway
    participant V as m402Vault
    participant I as Indexer
    participant O as Origin API

    A->>G: GET /s/:id
    G-->>A: 402 { serviceId, price, vaultAddress }

    Note over A: prove pay() locally — seconds<br/>no address goes into this transaction
    A->>V: submit pay() tx
    V->>V: assert colour == m402 credit
    V->>V: assert value == price
    V->>V: receipt = deriveReceipt(receiptSecret, serviceId)
    V->>V: assert receipt unseen, then insert
    V->>V: merchantBalance += price

    A->>G: GET /s/:id + X-Payment: receiptSecret
    G->>G: hash(secret, serviceId)
    G->>I: is that hash in the receipts set?
    I-->>G: confirmed — verify ~3.4ms
    G->>O: proxy request
    O-->>G: resource
    G-->>A: resource
```

Two things here are not optional. The **colour assert** — `receiveShielded` does not check
what token it receives, so without it any minted token would buy API calls. And the
**receipt**: only `deriveReceipt(secret, serviceId)` is published, so an observer watching
the indexer cannot lift a redemption credential off the chain.

The amount is `==`, not `>=`. `pay` consumes the whole coin but credits only `price`, so an
overpaying coin would burn the difference.

The gateway checks one more thing the diagram omits: before dispatching, it also checks the
hash against a **local** consumed-receipts table. `receipts` is append-only — it proves a
payment happened, never that this particular access grant is still unspent — so that second
check is the gateway's own replay guard, not something the chain can enforce for it.

## Payment — relayed x402 service

Identical up to verification. Only fulfilment differs.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant G as Gateway
    participant R as Relayer
    participant X as x402 service (EVM)
    participant F as Facilitator

    Note over A,G: 402 → pay() → receipt confirmed<br/>(as above)

    G->>R: dispatch, type = "relay"
    R->>X: GET resource
    X-->>R: 402 payment-required { amount, asset, network }
    R->>R: drop offers above the per-request cap
    R->>X: signed payment authorization + retry
    X->>F: verify + settle
    F->>F: submit the USDC transfer, pay the gas
    X-->>R: resource + settlement receipt
    R-->>G: resource
    G-->>A: resource
```

The relayer signs an authorization; the **facilitator** submits the transfer and pays the gas.
The relayer therefore needs USDC but no native ETH. The settlement receipt returned with the
resource carries the transaction hash, which is the only evidence that value actually moved —
a `200` alone does not distinguish a settled call from a server that skipped settlement.

## Registration

```mermaid
sequenceDiagram
    autonumber
    participant M as Merchant
    participant W as Web UI
    participant L as Lace
    participant V as m402Vault
    participant GW as Gateway registry

    M->>W: URL + price in USD
    W->>W: salt = 32 random bytes
    W->>W: convert USD → STAR (fixed rate)
    W->>W: serviceId = deriveServiceId(owner, salt, price)
    W->>L: request signature
    L->>M: approve
    L->>V: registerService(salt, price, owner)
    V->>V: serviceId = hash(domain, owner, salt, price)
    V->>V: assert not already registered
    W->>GW: POST /services { id, price, owner, target }
    GW->>V: queryContractState — read serviceOwner[id]
    alt not yet visible on-chain
      GW-->>W: 503 registration-not-yet-confirmed — retry
    else owner mismatch
      GW-->>W: 403 owner-mismatch
    else confirmed match
      GW->>GW: store serviceId → URL
      GW-->>W: 201
    end
    W-->>M: m402 URL
```

`owner` is the merchant's unshielded Lace address — it is the payout destination, so no
merchant secret exists. Deriving `serviceId` from `owner` is what defeats front-running: an
observer who copies this transaction and substitutes their own address produces a *different*
id and cannot capture the merchant's.

`price` is bound into the id for the same reason, so the conversion to STAR must happen
**before** the id is derived. Every argument of a pending registration is public. While the
id bound only the owner, an observer could copy the owner and salt, set `price` to 1, and win
the race — leaving the merchant with a service permanently priced at 1.

The gateway's registry entry is not optimistic. `POST /services` is a separate, off-chain call
— the contract never stores a URL — and the gateway does not take its body on faith: it reads
`serviceOwner[id]` back from the chain first and only stores the mapping once that matches.
There is no unconfirmed "confirming…" state to badge; the web UI retries the `503` until the
`registerService` transaction has actually landed.

## Withdrawal

The payout address is read from the ledger, so no caller authentication is needed and the
funds can only reach the registered merchant.

```mermaid
sequenceDiagram
    autonumber
    participant M as Merchant
    participant L as Lace
    participant V as m402Vault

    M->>L: withdraw(serviceId, amount)
    L->>V: withdraw(serviceId, amount)
    V->>V: owner = serviceOwner.lookup(serviceId)
    V->>V: assert balance >= amount
    V-->>M: sendUnshielded(NIGHT) → owner's address
    V->>V: merchantBalance -= amount
```

`sendUnshielded` takes a `UserAddress` and has no coin-ciphertext restriction, so the vault
can pay any address rather than only its caller. No pot coin and no change coin to track.

## Selective disclosure

No extra circuit. The `receipts` set already holds a commitment to each purchase.

```mermaid
sequenceDiagram
    autonumber
    participant P as Payer
    participant Au as Auditor
    participant L as Public ledger

    Note over P: holds (receiptSecret, serviceId)
    P->>Au: opening, encrypted to auditor key
    Au->>Au: recompute hash(domain, secret, serviceId)
    Au->>L: is it in the receipts set?
    L-->>Au: yes

    Note over Au: learns this payment was made<br/>by this payer, and nothing else
```

## Trust boundaries

```mermaid
flowchart TB
    subgraph private["Agent's machine — private"]
        who["payer identity"]
        nonce["coin nonce"]
        secret["receipt secret"]
        prover["local proof server"]
    end

    subgraph chain["Midnight ledger — public"]
        receipt["receipt hash"]
        price["price"]
        volume["merchant volume"]
        reserve["pooled NIGHT reserve"]
        deposits["deposit + withdrawal<br/>amounts and addresses"]
    end

    subgraph trusted["Trusted operator"]
        relayer["relayer USDC float"]
    end

    who --> prover
    nonce --> prover
    secret --> prover
    prover --> receipt
    price --> receipt
```

**No address appears in a payment.** `pay` takes no payer argument and reads no caller
identity, so the ledger records that *someone* holding a valid credit paid — and two payments
by the same agent cannot be linked.

The amount is **not** hidden: it equals the published `price`. Deposits, redemptions and
withdrawals sit outside the boundary entirely, public in amount and address. Both are
inherent to backing a shielded credit with an unshielded reserve. Full list in
[`../roadmap.md`](../roadmap.md#known-limitations).
