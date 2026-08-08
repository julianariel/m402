# agent

Agent CLI for the m402 payment flow: deposit NIGHT into the vault, pay for a gateway
resource with shielded credit, and redeem unspent credit back to NIGHT.

## Setup

Use Node 24 (`nvm use`) and start the Midnight proof server on `127.0.0.1:6300`. Compile
the contract artifacts once:

```bash
npm run compile --workspace contracts
npm run build
npm link --workspace agent
cp agent/.env.example agent/.env
```

Set `MIDNIGHT_PREVIEW_MNEMONIC_FILE` in `agent/.env` to the file containing the wallet
mnemonic. **The variable holds a path, never the words themselves** — argv is visible to
`ps`, and environment variables are inherited by every child process. Keep the file mode
`600`; it is a wallet secret.

A relative path is resolved against `agent/.env`, the file that declared it, so
`MIDNIGHT_PREVIEW_MNEMONIC_FILE=.mnemonic` works from any directory. `--mnemonic-file`
resolves against the working directory, as a CLI flag should.

The current persistent Preview vault is included in `.env.example`, but it is configuration,
not a constant. A future deployment can be selected with `M402_VAULT_ADDRESS` or overridden
for one invocation with `--vault`.

## Commands

The workspace exposes the executable as `m402`:

```bash
m402 deposit 5000
m402 call http://127.0.0.1:8787/s/<service-id>
m402 call http://127.0.0.1:8787/s/<service-id> --dry-run
m402 redeem 1000 --yes
```

`deposit` and `redeem` require the configured vault. `call` reads the vault from the
gateway's HTTP 402 response and refuses a mismatch with `M402_VAULT_ADDRESS` unless
`--allow-other-vault` is explicitly supplied.

Progress and payment timings are written to stderr. The resource body is written unchanged
to stdout, so calls remain composable:

```bash
m402 call http://127.0.0.1:8787/s/<service-id> | jq
```

Use `--json` for structured command metadata, `--no-color` for plain output, and `--debug`
to include unexpected stack traces.

## Using m402 from an agent

### You do not need this CLI to consume a service

The gateway speaks ordinary HTTP 402. Any client in any language can do the whole exchange
with two requests and no Midnight code:

```
GET /s/<service-id>                     -> 402 {serviceId, price, vaultAddress}
GET /s/<service-id>  X-Payment: <hex>   -> 200 <the resource>
```

What the CLI supplies is the middle step — turning `price` into a `receiptSecret` by building,
proving and submitting a Midnight transaction, then holding that secret durably until the
resource is actually delivered. That is the part you do not want to reimplement per agent.

So `m402 call <url>` takes the same URL a plain `curl` would use. It is a `curl` that knows
how to pay.

### The loop

Deposit once, then call as often as needed. Only `deposit` and `redeem` touch NIGHT; a `call`
spends already-shielded credit.

```bash
m402 deposit 5000                        # once: NIGHT -> shielded credit
m402 call https://gw.example/s/<id>       # per request, prints the resource to stdout
m402 redeem 4500 --yes                    # when finished: unspent credit -> NIGHT
```

stdout carries **only** the resource body, byte for byte; progress and timings go to stderr.
An agent can therefore pipe it directly:

```bash
DATA=$(m402 call https://gw.example/s/<id>) || handle_failure $?
```

Use `--json` when the agent needs metadata rather than the raw body, and `--dry-run` to read
the price and service id without paying.

### Branch on the exit code, not on stderr text

| code | meaning | what an agent should do |
|---|---|---|
| `0` | resource delivered on stdout | proceed |
| `1` | unexpected failure | do not retry blindly; re-run with `--debug` |
| `2` | configuration or usage error | fix config; retrying cannot help |
| `3` | operational error — proof server down, credit already spent, another operation holding the lock | resolve the named cause, then retry |
| `4` | gateway or network unreachable, or wallet sync timed out | retry with backoff |

Only `4`, and `3` once its cause is cleared, are worth retrying automatically.

### Concurrency

One wallet cannot submit two Midnight transactions at once, so a local lock serializes
`deposit`, `call` and `redeem` against the same state file. A second invocation fails with
exit `3` rather than racing. **Agents must serialize their own calls** — parallel `m402 call`
against one wallet is not a supported mode. See `docs/constraints.md`.

### Cost of a call

A real `call` builds and proves a transaction, so it is seconds, not milliseconds, and it is
dominated by wallet sync and proving. `--dry-run`, `--help` and `--version` never load the
wallet stack at all and return in well under a second.

## Recovery and safety

- Receipt secrets are generated and written to `agent/.state/<network>.json` with mode 600
  **before** transaction construction starts. The receipt hash is derived through the
  contract's exported `deriveReceipt` pure circuit.
- If the process exits after payment but before resource delivery, the next `call` resumes
  the saved receipt instead of paying again. `--fresh` deliberately bypasses recovery and
  should only be used after confirming the saved receipt did not land on-chain.
- A local lock serializes wallet operations. Starting a second `deposit`, `pay`, or `redeem`
  against the same state file fails rather than racing wallet/private state.
- `redeem` always sends NIGHT to the active wallet's own unshielded address. There is no CLI
  recipient argument to accidentally redirect funds.
- The proof server must remain bound to loopback; proof requests carry private witness data.

The state file and `midnight-level-db` contain bearer credentials and contract private state.
They are gitignored and should be treated as wallet secrets.
