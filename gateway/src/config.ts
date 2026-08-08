export const config = {
  port: Number(process.env.PORT ?? 8787),
  vaultAddress: process.env.VAULT_ADDRESS ?? '',
  dbPath: process.env.DB_PATH ?? 'gateway.db',
  indexerUrl: process.env.INDEXER_URL ?? 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUrl: process.env.INDEXER_WS_URL ?? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  relayerKeyFile: process.env.RELAYER_KEY_FILE ?? './relayer.key',
  relayerMaxPayment: BigInt(process.env.RELAYER_MAX_PAYMENT ?? '100000'),
  relayTargetAllowlist: new Set(
    (process.env.RELAY_TARGET_ALLOWLIST ?? '').split(',').map((target) => target.trim()).filter(Boolean)
  ),
  verifyTimeoutMs: 60_000,
};
