# Flow diagrams

## Deposit

Public by nature: unshielded NIGHT in, shielded credit out. Done once, not per call.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant L as Lace
    participant V as m402Vault

    A->>L: deposit(amount)
    L->>V: unshielded NIGHT
    V->>V: receiveUnshielded(nativeToken(), amount)
    V->>V: mintShieldedToken(credit, amount)
    V-->>A: shielded credit coin
    Note over A,V: amount and address are public here<br/>and only here
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

    Note over A: prove pay() locally<br/>credit amount stays on this machine
    A->>V: submit pay() tx
    V->>V: assert colour is m402 credit<br/>assert amount >= price<br/>insert nullifier<br/>credit merchant by public price

    A->>G: GET /s/:id + X-Payment: nullifier
    G->>I: watch for nullifier
    I-->>G: nullifier confirmed
    G->>O: proxy request
    O-->>G: resource
    G-->>A: resource
```

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

    M->>W: URL + price in USD
    W->>W: convert USD → STAR (fixed rate)
    W->>L: request signature
    L->>M: approve
    L->>V: registerService(serviceId, price, owner)
    W-->>M: m402 URL (confirming…)
    Note over W,V: flips to "live" once the indexer sees it
```

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
    V->>V: owner = serviceOwner.lookup(serviceId)<br/>assert balance >= amount
    V-->>M: sendUnshielded(NIGHT) to owner's address
```

## Selective disclosure

No on-chain step and no additional circuit. The nullifier already commits to the payment.

```mermaid
sequenceDiagram
    autonumber
    participant P as Payer
    participant Au as Auditor
    participant L as Public ledger

    Note over P: holds (nonce, serviceId, amount)
    P->>Au: opening, encrypted to auditor key
    Au->>L: read nullifier
    Au->>Au: recompute hash(nonce, serviceId, amount)
    Au->>Au: compare to on-chain nullifier

    Note over Au: learns this payment's amount<br/>and nothing else
```

## Trust boundaries

```mermaid
flowchart LR
    subgraph private["Agent's machine — private"]
        amount["credit amount"]
        nonce["coin nonce"]
        prover["local proof server"]
    end

    subgraph chain["Midnight ledger — public"]
        nullifier["nullifier"]
        price["price"]
        volume["merchant volume"]
    end

    subgraph trusted["Trusted operator"]
        relayer["relayer USDC float"]
    end

    amount --> prover
    nonce --> prover
    prover --> nullifier
    price --> nullifier
```

`amount` and `nonce` never leave the agent's machine. The ledger records only that a payment
of at least `price` occurred. Deposits and withdrawals sit outside this boundary and are
public.
