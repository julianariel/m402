# Flow diagrams

Sequence and boundary diagrams for each operation. The contract they describe is
[`../../contracts/src/m402Vault.compact`](../../contracts/src/m402Vault.compact); the
reasoning behind the shapes is in [`../design.md`](../design.md).

## Value lifecycle

Where money enters, moves, and leaves. **NIGHT is unshielded**, so it cannot be spent
privately — the vault pools it and issues a shielded credit against it 1:1. Privacy lives
entirely in the middle step.

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
    pay --> bal
    bal -->|"withdraw()"| out

    pool[("pooled NIGHT<br/>reserve")]
    night -.->|backs| pool
    pool -.->|backs| out
```

The reserve's balance is public, but it moves **only** on deposit and withdrawal — never on
payment. That is what stops payment amounts being recovered by differencing it.

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

    Note over A: prove pay() locally — ~19s<br/>credit value never leaves this machine
    A->>V: submit pay() tx
    V->>V: assert colour == m402 credit
    V->>V: assert value >= price
    V->>V: nullifier = hash(nonce, serviceId, value)
    V->>V: assert nullifier unspent, then insert
    V->>V: merchantBalance += price (public price, not value)

    A->>G: GET /s/:id + X-Payment: nullifier
    G->>I: watch for nullifier
    I-->>G: nullifier confirmed — verify ~3.4ms
    G->>O: proxy request
    O-->>G: resource
    G-->>A: resource
```

The colour assert is not optional: `receiveShielded` does not check what token it receives,
so without it any minted token would buy API calls.

## Payment — relayed x402 service

Identical up to verification. Only fulfilment differs.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant G as Gateway
    participant R as Relayer
    participant X as x402 service (EVM)

    Note over A,G: 402 → pay() → nullifier confirmed<br/>(as above)

    G->>R: dispatch, type = "relay"
    R->>X: GET resource
    X-->>R: 402 { price in USDC }
    R->>X: pay USDC + retry
    X-->>R: resource
    R-->>G: resource
    G-->>A: resource
```

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
    W->>W: serviceId = 32 random bytes
    W->>W: convert USD → STAR (fixed rate)
    W->>L: request signature
    L->>M: approve
    L->>V: registerService(serviceId, price, owner)
    V->>V: assert serviceId not already registered
    W->>GW: store serviceId → URL
    W-->>M: m402 URL (confirming…)
    Note over W,V: flips to "live" once the indexer sees it
```

`owner` is the merchant's unshielded Lace address — it is the payout destination, so no
merchant secret exists. Registration is first-come and immutable; without that guard anyone
could re-register a `serviceId` and redirect its revenue.

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

No on-chain step and no additional circuit. The nullifier already commits to the payment.

```mermaid
sequenceDiagram
    autonumber
    participant P as Payer
    participant Au as Auditor
    participant L as Public ledger

    Note over P: holds (nonce, serviceId, value)
    P->>Au: opening, encrypted to auditor key
    Au->>L: read nullifier
    Au->>Au: recompute hash(nonce, serviceId, value)
    Au->>Au: compare to on-chain nullifier

    Note over Au: learns this payment's amount<br/>and nothing else
```

## Trust boundaries

```mermaid
flowchart TB
    subgraph private["Agent's machine — private"]
        value["credit value"]
        nonce["coin nonce"]
        prover["local proof server"]
    end

    subgraph chain["Midnight ledger — public"]
        nullifier["nullifier"]
        price["price"]
        volume["merchant volume"]
        reserve["pooled NIGHT reserve"]
        deposits["deposit + withdrawal<br/>amounts and addresses"]
    end

    subgraph trusted["Trusted operator"]
        relayer["relayer USDC float"]
    end

    value --> prover
    nonce --> prover
    prover --> nullifier
    price --> nullifier
```

`value` and `nonce` never leave the agent's machine, and the ledger records only that a
payment of at least `price` occurred.

Deposits and withdrawals sit **outside** that boundary: both amount and address are public.
This is inherent to backing a shielded credit with an unshielded reserve, and is the trade
every shielded pool makes. Full list in [`../roadmap.md`](../roadmap.md#known-limitations).
