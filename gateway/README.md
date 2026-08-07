# gateway

Proxy and payment verifier. Resolves a service, returns `402`, watches the indexer for the
payment nullifier, then dispatches to an origin API or the EVM relayer.

Holds no funds and signs nothing — it only reads the chain.
See [`../docs/design.md`](../docs/design.md#5-gateway).
