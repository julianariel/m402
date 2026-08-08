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

Set `MIDNIGHT_PREVIEW_MNEMONIC_FILE` in `agent/.env` to an absolute path containing the
wallet mnemonic. The environment variable contains the path, never the words themselves.

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
