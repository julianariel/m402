import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATEWAY_DIR = fileURLToPath(new URL('../', import.meta.url));

try {
  loadEnvFile(path.join(GATEWAY_DIR, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy gateway/.env.example to gateway/.env and fill it in.`);
  }
  return value;
}

export const config = {
  port: Number(requireEnv('PORT')),
  vaultAddress: requireEnv('VAULT_ADDRESS'),
  dbPath: requireEnv('DB_PATH'),
  indexerUrl: requireEnv('INDEXER_URL'),
  indexerWsUrl: requireEnv('INDEXER_WS_URL'),
  // Read lazily by dispatch.ts on the first relay dispatch, not at startup — an origin-only
  // deployment never touches this, so it stays required in .env.example but isn't validated here.
  relayerKeyFile: requireEnv('RELAYER_KEY_FILE'),
  // Defaulted, not required: an origin-only deployment never relays, and RELAY_TARGET_ALLOWLIST
  // defaulting to empty is the safe-by-default choice (denies all relay registrations) rather
  // than a startup requirement. See README's Environment table.
  relayerMaxPayment: BigInt(process.env.RELAYER_MAX_PAYMENT ?? '100000'),
  relayTargetAllowlist: new Set(
    (process.env.RELAY_TARGET_ALLOWLIST ?? '').split(',').map((target) => target.trim()).filter(Boolean)
  ),
  verifyTimeoutMs: Number(requireEnv('VERIFY_TIMEOUT_MS')),
};
