/**
 * Claim a merchant balance from a headless wallet.
 *
 * `withdraw` reads its payout address from `serviceOwner` on the ledger and authenticates
 * nobody, so the NIGHT always reaches the merchant who registered the service no matter who
 * submits. That makes this a safe way around a wallet extension that cannot build the
 * transaction itself — the funds cannot be redirected here.
 *
 *   MIDNIGHT_NETWORK=preview \
 *   MIDNIGHT_PREVIEW_MNEMONIC_FILE=/path/to/.mnemonic \
 *   M402_VAULT_ADDRESS=<hex> \
 *   M402_PRIVATE_STATE_PASSWORD=<pw> \
 *   npx tsx src/withdraw-balance.ts <serviceId-hex> <amount-star>
 *
 * The mnemonic is read from a FILE. Never pass the words in argv or an env var — both leak
 * through `ps` and shell history.
 */
import { readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { getConfig } from './lib/config.js';
import { buildAgentContext, stopAgentContext, withdrawMerchantBalance } from './client.js';
import type { WalletSecret } from './lib/wallet.js';

// Load the agent's .env through Node rather than sourcing it in a shell. A value containing
// a shell metacharacter (`$`, a backtick) is silently expanded by `. file`, which corrupts
// secrets without any error — M402_PRIVATE_STATE_PASSWORD arrives short and the SDK rejects
// it. Same mechanism gateway/src/config.ts uses.
const envFile = process.env['M402_ENV_FILE'];
if (envFile) {
  try {
    loadEnvFile(envFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

function resolveSecret(net: string): WalletSecret {
  if (net === 'local') {
    return { kind: 'seed', value: '0000000000000000000000000000000000000000000000000000000000000001' };
  }
  const upper = net.toUpperCase();
  const file = process.env[`MIDNIGHT_${upper}_MNEMONIC_FILE`] ?? process.env['MIDNIGHT_MNEMONIC_FILE'];
  if (!file) {
    throw new Error(
      `Set MIDNIGHT_${upper}_MNEMONIC_FILE to a path holding the phrase (mode 600, gitignored). ` +
        'Never pass the words themselves in argv or an env var.',
    );
  }
  const words = readFileSync(file, 'utf8')
    .replace(/\d+[.)]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error(`${file}: expected a 12-24 word mnemonic, found ${words.length} words.`);
  }
  return { kind: 'mnemonic', value: words.join(' ') };
}

async function main(): Promise<void> {
  const [serviceIdHex, amountRaw] = process.argv.slice(2);
  const vault = process.env['M402_VAULT_ADDRESS'];

  if (!serviceIdHex || !amountRaw) throw new Error('usage: withdraw-balance.ts <serviceId-hex> <amount-star>');
  if (!/^[0-9a-fA-F]{64}$/.test(serviceIdHex)) throw new Error('serviceId must be 32-byte hex.');
  if (!vault) throw new Error('Set M402_VAULT_ADDRESS.');

  const amount = BigInt(amountRaw);
  const serviceId = Uint8Array.from(Buffer.from(serviceIdHex, 'hex'));

  console.log(`network ${network} | vault ${vault}`);
  console.log(`withdraw ${amount} STAR against service ${serviceIdHex.slice(0, 16)}…`);

  // Point these at the agent CLI's own directories to resume from its warm cache — a cold
  // replay of this wallet is minutes, a warm resume is seconds.
  const context = await buildAgentContext({
    config: getConfig(),
    contractAddress: vault,
    secret: resolveSecret(network),
    syncCacheDir: process.env['MIDNIGHT_SYNC_CACHE_DIR'] ?? '.sync-cache',
    ...(process.env['MIDNIGHT_DB_NAME'] ? { midnightDbName: process.env['MIDNIGHT_DB_NAME'] } : {}),
    ...(process.env['M402_PRIVATE_STATE_STORE'] ? { privateStateStoreName: process.env['M402_PRIVATE_STATE_STORE'] } : {}),
    onPhase: (phase) => console.log(`  ${phase}…`),
  });

  try {
    const timing = await withdrawMerchantBalance(context, serviceId, amount, {
      onSubmitted: ({ txId }) => console.log(`  submitted ${txId}`),
    });
    console.log(`\nconfirmed | prove ${timing.proveMs}ms | submit ${timing.submitMs}ms | chain ${timing.confirmMs}ms`);
  } finally {
    await stopAgentContext(context);
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
