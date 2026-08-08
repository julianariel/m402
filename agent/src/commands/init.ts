import { requireVaultAddress, type AgentConfig } from '../config.js';
import type { Output } from '../output.js';
import { formatDuration } from '../output.js';
import { loadClient } from './client.js';
import { withAgentContext } from './common.js';

/**
 * Warm the wallet and report what it holds.
 *
 * `init` submits nothing and costs nothing on-chain. Its whole job is to pay the wallet sync
 * at a moment you choose rather than inside whichever command you happen to run first.
 *
 * A wallet built from a seed starts at `appliedIndex === 0` and the indexer streams it every
 * event from the beginning — measured at 687s against Preview. `buildAgentContext` caches the
 * synced sub-wallet states, so the next command resumes instead: 54s, of which ~19s is
 * proving. `init` is simply the first run, made explicit and named, so the eleven minutes
 * happen before a demo rather than during one.
 *
 * It reports credit as individual COIN VALUES, not just a total, because `pay` asserts
 * `coin.value == price` exactly and there is no change. See ./deposit.ts.
 */
export async function initCommand(config: AgentConfig, output: Output): Promise<void> {
  const vaultAddress = requireVaultAddress(config);
  output.info(`Network: ${config.network} | Vault: ${vaultAddress}`);

  const { summarizeWallet } = await loadClient();
  const { readVaultState } = await import('contracts/inspect-vault');

  const startedAt = Date.now();
  const summary = await withAgentContext(config, vaultAddress, output, (context) =>
    summarizeWallet(context),
  );
  const elapsed = Date.now() - startedAt;

  const vault = await readVaultState(vaultAddress, config.networkConfig);

  if (output.options.json) {
    output.data({
      restoredFromCache: summary.restoredFromCache,
      syncMs: elapsed,
      night: summary.night.toString(),
      creditTotal: summary.creditTotal.toString(),
      creditCoins: summary.creditCoins.map(String),
      services: vault?.services.map((s) => ({ id: s.id, price: s.price.toString() })) ?? [],
    });
    return;
  }

  output.success(
    `Wallet ready in ${formatDuration(elapsed)} ` +
      `(${summary.restoredFromCache ? 'resumed from cache' : 'replayed from scratch'}).`,
  );
  output.info(`NIGHT: ${summary.night}`);

  if (summary.creditCoins.length) {
    output.info(
      `Credit: ${summary.creditTotal} STAR as ${summary.creditCoins.length} coin(s): ` +
        summary.creditCoins.join(', '),
    );
  } else {
    output.info('Credit: none. Run m402 deposit <price> before calling a service.');
  }

  if (!vault) {
    output.warn('Vault state is not indexed yet; service prices are unavailable.');
    return;
  }

  if (!vault.services.length) {
    output.info('No services registered on this vault yet.');
    return;
  }

  output.info(`Services registered: ${vault.services.length}`);
  for (const service of vault.services) {
    // Flag payability per service: a coin must match the price exactly.
    const payable = summary.creditCoins.includes(service.price);
    output.info(
      `  ${service.id.slice(0, 16)}...  ${service.price} STAR  ` +
        `${payable ? 'payable now' : `needs: m402 deposit ${service.price}`}`,
    );
  }
}
