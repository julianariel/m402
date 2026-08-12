import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ensurePrivateStatePassword,
  normalizeMnemonic,
  requireVaultAddress,
  type AgentConfig,
} from '../config.js';
import { CliError } from '../errors.js';
import type { Output } from '../output.js';
import { formatDuration } from '../output.js';
import { loadClient } from './client.js';
import { withAgentContext } from './common.js';

export type InitOptions =
  | { mode: 'warm' }
  | { mode: 'new'; force: boolean; noFaucet: boolean }
  | { mode: 'import'; importFile: string; force: boolean; noFaucet: boolean };

export async function initCommand(
  config: AgentConfig,
  output: Output,
  options: InitOptions = { mode: 'warm' },
): Promise<void> {
  if (options.mode === 'warm') return initWarm(config, output);
  return initFresh(config, output, options);
}

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
 * Credit is reported as a total AND as individual coin values. Spending only needs the total
 * to cover the price: `pay` receives a coin worth exactly `price`, but the wallet's balancer
 * splits a larger coin and keeps the remainder as change. The denominations are shown because
 * they explain the shielded balance you would otherwise see as one opaque number, not because
 * they gate what you can buy.
 */
async function initWarm(config: AgentConfig, output: Output): Promise<void> {
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
    // Total, not denominations. `pay` needs a coin worth exactly `price`, but the wallet's
    // balancer splits a larger coin and takes the remainder back as change - proven by
    // deploy.test.ts, which deposits 5000 once, pays 500 three times and redeems the 3500
    // left over. Only the total has to cover the price.
    const payable = summary.creditTotal >= service.price;
    output.info(
      `  ${service.id.slice(0, 16)}...  ${service.price} STAR  ` +
        `${payable ? 'payable' : `short by ${service.price - summary.creditTotal}`}`,
    );
  }
}

/** Refuses to clobber an existing wallet file without `--force`, so a re-run of `init --new`
 * cannot silently destroy a funded wallet. */
function writeMnemonicFile(file: string, mnemonic: string, force: boolean): void {
  if (existsSync(file) && !force) {
    throw new CliError(
      `A wallet already exists at ${file}.`,
      2,
      'Pass --force to overwrite it, or move it aside yourself first.',
    );
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${mnemonic}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readImportFile(resolved: string): string {
  try {
    return readFileSync(resolved, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`No mnemonic file at ${resolved}.`, 2);
    }
    throw error;
  }
}

/**
 * `init --new` / `init --import`: generate or import a wallet, fund it, register it for DUST,
 * report ready. This is the beat that carries the demo — see the plan's risk section on why
 * the address is printed before the sync, not after.
 */
async function initFresh(
  config: AgentConfig,
  output: Output,
  options: Extract<InitOptions, { mode: 'new' | 'import' }>,
): Promise<void> {
  const vaultAddress = requireVaultAddress(config);

  let mnemonic: string;
  if (options.mode === 'import') {
    const resolved = path.resolve(options.importFile);
    mnemonic = normalizeMnemonic(readImportFile(resolved), resolved);
  } else {
    const { generateMnemonicWords } = await import('@midnight-ntwrk/wallet-sdk-hd');
    mnemonic = generateMnemonicWords().join(' ');
  }

  writeMnemonicFile(config.mnemonicFile, mnemonic, options.force);
  output.success(
    `${options.mode === 'import' ? 'Imported' : 'Generated'} wallet written to ${config.mnemonicFile}.`,
  );

  const { generated } = ensurePrivateStatePassword(config);
  if (generated) output.info(`Generated a private-state password, stored in ${config.configFile}.`);

  const client = await loadClient();
  const address = client.deriveUnshieldedAddress(
    { kind: 'mnemonic', value: mnemonic },
    config.networkConfig.networkId,
  );
  output.info(`Address: ${address}`);

  if (options.noFaucet) {
    output.info(`Skipping the faucet. Fund ${address} manually; the wait step below will pick it up.`);
  } else if (config.networkConfig.faucet) {
    output.info('Requesting a faucet drip...');
    const drip = await client.requestFaucetDrip(address, config.networkConfig.faucet);
    if (!drip.ok) {
      output.warn(
        `Faucet drip failed (${drip.error}). Fund ${address} manually; the wait step below will pick it up.`,
      );
    }
  } else {
    output.warn(`No faucet configured for ${config.network}. Fund ${address} manually.`);
  }

  await withAgentContext(config, vaultAddress, output, async (context) => {
    // The faucet drip above and this sync overlap: the multi-minute wallet sync gives the
    // drip time to land before this wait even starts, so it usually resolves immediately.
    const nightSpinner = output.spinner('waiting for NIGHT');
    let night: bigint;
    try {
      night = await client.waitForNightBalance(context);
    } catch (error) {
      nightSpinner.stop();
      throw error;
    }
    nightSpinner.stop(`NIGHT: ${night}`);

    const dustSpinner = output.spinner('registering for DUST generation');
    const registration = await client.registerForDustGeneration(context);
    dustSpinner.stop(
      registration.registeredCount > 0
        ? `DUST registration confirmed (tx ${registration.txId.slice(0, 16)}...)`
        : `DUST registration submitted, not yet confirmed (tx ${registration.txId.slice(0, 16)}...)`,
    );

    const summary = await client.summarizeWallet(context);

    if (output.options.json) {
      output.data({
        address,
        night: night.toString(),
        dustRegistered: registration.registeredCount > 0,
        dustTxId: registration.txId,
        creditTotal: summary.creditTotal.toString(),
        vault: vaultAddress,
      });
      return;
    }

    output.success('Wallet ready.');
    output.info(`Address: ${address}`);
    output.info(`NIGHT: ${night}`);
    output.info(
      `DUST registration: ${registration.registeredCount > 0 ? 'confirmed' : 'submitted, not yet confirmed'}`,
    );
    output.info(`Credit: ${summary.creditTotal} STAR`);
    output.info(`Vault: ${vaultAddress}`);
  });
}
