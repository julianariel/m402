# contracts

`m402Vault.compact` — the payment vault.

Three circuits: `registerService`, `pay`, `withdraw`. See
[`../docs/design.md`](../docs/design.md#3-contract--m402vaultcompact).

Requires the Compact toolchain and a local proof server on `:6300`.

Build:

```
compact compile src/m402Vault.compact managed/m402Vault
```

`managed/` is generated and gitignored.

---

## Confirmed stdlib signatures

Verified against **compact 0.31.1**, `pragma language_version 0.23`, by compiling.
Do not re-derive these — they cost a compile cycle each.

### Shielded value

```compact
struct ShieldedCoinInfo          { nonce: Bytes<32>; color: Bytes<32>; value: Uint<128>; }
struct QualifiedShieldedCoinInfo { nonce: Bytes<32>; color: Bytes<32>; value: Uint<128>; mtIndex: Uint<64>; }
struct ShieldedSendResult        { change: Maybe<ShieldedCoinInfo>; sent: ShieldedCoinInfo; }

circuit receiveShielded(coin: ShieldedCoinInfo): [];
circuit sendShielded(input: QualifiedShieldedCoinInfo,
                     recipient: Either<ZswapCoinPublicKey, ContractAddress>,
                     value: Uint<128>): ShieldedSendResult;
circuit sendImmediateShielded(input: ShieldedCoinInfo, ...): ShieldedSendResult;  // fresh coins only
```

`receiveShielded` takes a **coin, not an amount**. The amount is `coin.value`, a
`Uint<128>` — compare it against a `Uint<64>` price with an explicit cast.

`receiveShielded(coin)` requires `disclose(coin)`. The compiler is explicit that what
this discloses is the *coin commitment* — a hash — not the value:

```
the call to standard-library circuit receiveShielded might disclose a link between a
coin receive and the coin with the commitment given by a hash of the witness value
```

Recipients are wrapped: `left<ZswapCoinPublicKey, ContractAddress>(...)` for a user key,
`right<...>(kernel.self())` for this contract.

### Hashing

```compact
persistentHash<Vector<2, Bytes<32>>>([a, b])
```

The type argument is **required** and the input is a homogeneous `Vector`, so every
element must be `Bytes<32>`. A `Uint<64>` cannot go in without conversion.

### Map and Set

```compact
Map.insert(key, value)   Map.lookup(key)   Map.member(key)   Map.remove(key)
Map.size()               Map.isEmpty()     Map.insertDefault(key)
Set.insert(elem)         Set.member(elem)  Set.remove(elem)
```

**There is no `lookupOrDefault`.** `lookup` on a missing key aborts the transaction.
Guard every lookup:

```compact
const prior = m.member(k) ? m.lookup(k) : 0 as Uint<64>;
```

### Witnesses

```compact
witness paymentCoin(): ShieldedCoinInfo;
```

No body — TypeScript supplies it. A witness may return a struct.

Circuit **parameters are also private** by default. Witness vs. parameter is about where
the value comes from, not whether it is secret. Either way it needs `disclose()` before it
reaches public state.

### Asserts

`assert(cond, "message")` — the message argument is supported.

### Caller identity

There is no `msg.sender` on Midnight. `ownPublicKey()` is a witness: the prover picks its
return value and the protocol does not check it against the signer, so **it cannot gate a
circuit**. The only sound caller check is hash-of-secret,
`persistentHash([pad(32, "domain"), sk])`, which costs the user a secret to safeguard.

**m402 avoids needing one.** `withdraw` reads its payout destination from `serviceOwner`
rather than from the caller, so any caller sends the funds to the registered merchant.
Nothing to steal, nothing to authenticate, and merchant identity stays a Lace address.

Constructing a recipient from stored bytes:

```compact
left<ZswapCoinPublicKey, ContractAddress>(ZswapCoinPublicKey { bytes: owner })
```

Reach for hash-of-secret only where a circuit must restrict *who acts*, not merely *where
value lands*.

---

## Custody: why the pot is not in ledger state

Ledger state is public, including a `QualifiedShieldedCoinInfo` stored in a cell — its
`value` field is readable by anyone. A contract that holds its pot in a ledger cell
publishes the pot total on every payment, and consecutive totals differ by exactly the
amount paid. That would defeat `pay`'s entire purpose.

So the vault keeps **no coin in ledger state**. Public state is `merchantBalance` only,
which moves by the public `price`. The spendable pot is supplied to `withdraw` as a
witness; Zswap independently validates that the coin is real and contract-owned, and the
circuit bounds the payout by the recorded balance.

The consequence is that `sendShielded`'s change coin must be persisted off-chain by
whoever calls `withdraw`, and two merchants withdrawing concurrently would race for the
same pot coin. Single-operator only for now.
