# contracts

`m402Vault.compact` — the payment vault.

Five circuits: `registerService`, `deposit`, `pay`, `redeem`, `withdraw`, plus the pure
`deriveServiceId`. See
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
circuit mintShieldedToken(domainSep: Bytes<32>, value: Uint<64>, nonce: Bytes<32>,
                          recipient: Either<ZswapCoinPublicKey, ContractAddress>): ShieldedCoinInfo;
circuit tokenType(domainSep: Bytes<32>, contract: ContractAddress): Bytes<32>;
circuit nativeToken(): Bytes<32>;
```

### Unshielded value

Note the **argument order differs** from the shielded pair, and the recipient is a
`UserAddress`, not a `ZswapCoinPublicKey`:

```compact
circuit receiveUnshielded(color: Bytes<32>, amount: Uint<128>): [];
circuit sendUnshielded(color: Bytes<32>, value: Uint<128>,
                       recipient: Either<ContractAddress, UserAddress>): [];
```

`right<ContractAddress, UserAddress>(UserAddress { bytes: owner })` targets a user's
unshielded Lace address. Unlike `sendShielded`, this has no coin-ciphertext restriction, so a
contract can pay any address — not only its caller.

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

Reach for hash-of-secret only where a circuit must restrict *who acts*, not merely *where
value lands*.

`ownPublicKey()` stays correct as a *destination* — `deposit` uses it to route the minted
credit to the caller, and a caller who lies only misdirects their own deposit.

---

## Why the payment asset is a minted credit, not NIGHT

`nativeToken()` returns an `UnshieldedTokenType`, and shielded and unshielded token types are
separately tagged namespaces. **There is no shielded NIGHT** — the tokenomics whitepaper says
so outright. NIGHT therefore cannot be the private payment asset.

The vault pools deposited NIGHT and mints a shielded credit against it 1:1:

| Circuit | Asset | Visibility |
|---|---|---|
| `deposit`  | unshielded NIGHT in, shielded credit out | public |
| `pay`      | shielded credit | **private** |
| `withdraw` | unshielded NIGHT out | public |

Two rules follow, and neither is optional.

**Never put a coin in ledger state.** Ledger state is public in full, including a
`QualifiedShieldedCoinInfo`'s `value`. A pot held there would publish its total after every
payment, and consecutive totals differ by exactly the amount paid. The pool's NIGHT balance is
public, but it moves only on deposit and withdrawal — never on payment — so payments cannot be
recovered by differencing it.

**Always assert the coin colour in `pay`.** `receiveShielded` does not check it. Without

```compact
assert(coin.color == tokenType(creditDomain(), kernel.self()), "not an m402 credit");
```

an attacker mints their own worthless shielded token and buys API calls with it. Contract
token colours are collision-resistant, so only this vault can mint that colour.

---

## Witness requirements

The contract is only as safe as these four witnesses. Every one of them fails **silently** if
implemented badly — no error, no on-chain signal, all tests green.

### `nonceSeed(): Bytes<32>`

Carries the unlinkability of every payment funded by a deposit.

- **MUST** return 32 fresh bytes from a CSPRNG on **every** call — `crypto.getRandomValues`.
  Never `Math.random`.
- **MUST NOT** derive from the wallet seed, the contract address, `mintCounter`, the amount,
  a timestamp, or anything else an observer can obtain. `evolveNonce` already mixes in the
  public `mintCounter`, so a constant seed still yields distinct, non-colliding nonces —
  every test passes and every payment is linkable to its depositor.
- **MUST** be persisted to private state before the transaction is submitted. Losing it loses
  the ability to spend the coin.
- **MUST NOT** be logged, sent to the gateway, or included in telemetry.

### `receiptSecret(): Bytes<32>`

The bearer credential for one purchase.

- Same entropy rules as `nonceSeed`.
- Released **only** in the `X-Payment` header, over TLS, after the payment confirms. Anyone
  who learns it before redemption can take the resource.
- Persisted before submitting — it is also the selective-disclosure opening.

### `creditCoin(serviceId, price): ShieldedCoinInfo`

- **MUST** return a coin worth **exactly `price`**. `pay` consumes the whole coin, so a larger
  one strands the remainder with no way to recover it. Split at the Zswap layer: spend the
  large coin, output `price` to the vault and the rest back to yourself in the same
  transaction — the change output's value stays hidden.
- **MUST** verify colour and value locally before proving; the circuit asserts both, and a
  local check turns a wasted 19s proof into an instant error.
- **MUST NOT** accept a coin from anything the gateway controls. The gateway is untrusted.
- **MUST** track spent coins in private state and never return one twice.

### `redeemCoin(): ShieldedCoinInfo`

- Returns the coin to cash out, consumed in full. Same local colour check.

