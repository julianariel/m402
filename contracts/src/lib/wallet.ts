import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import type { WalletFacade, FacadeState, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  WalletSeeds,
} from '@midnight-ntwrk/testkit-js';
import {
  createKeystore,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade as WalletFacadeClass,
} from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  /** Where to persist sync state once the wallet reaches a synced state; absent = no caching. */
  private readonly syncCache: { cache: WalletCache; tag: string } | undefined;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
    syncCache?: { cache: WalletCache; tag: string },
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
    this.syncCache = syncCache;
  }

  /**
   * Persists sync state so the next run resumes instead of replaying. Safe to call only after
   * the wallet is synced; a no-op when no cache was configured, and never throws.
   */
  async cacheSyncState(): Promise<void> {
    if (!this.syncCache) return;
    await saveWalletSyncState(this.logger, this.wallet, this.syncCache.cache, this.syncCache.tag);
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );

    // Any circuit that touches unshielded value — m402's `deposit`, via
    // receiveUnshielded — pulls a NIGHT UTXO into the transaction, and UTXO inputs
    // carry Schnorr signatures. Without this step the node rejects the transaction
    // with 1010 Custom error 192, InputsSignaturesLengthMismatch: one input, zero
    // signatures. Shielded-only calls need no signature, but signing a recipe that
    // has no unshielded inputs is a no-op, so this is unconditional.
    const signed = await this.wallet.signRecipe(recipe, (payload: Uint8Array) =>
      this.unshieldedKeystore.signData(payload),
    );

    return await this.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
    cache?: WalletCache,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    if (cache) {
      const restored = await MidnightWalletProvider.restore(logger, env, secret, dustOptions, cache);
      if (restored) return restored;
    }

    const base = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);
    const builder =
      secret.kind === 'mnemonic'
        ? base.withMnemonic(secret.value)
        : base.withSeed(secret.value);

    const buildResult = await builder.buildWithoutStarting();
    const { wallet, seeds, keystore } = buildResult as {
      wallet: WalletFacade;
      seeds: {
        masterSeed: string;
        shielded: Uint8Array;
        dust: Uint8Array;
      };
      keystore: UnshieldedKeystore;
    };

    logger.info(
      `Wallet built from ${secret.kind}; master seed: ${seeds.masterSeed.slice(0, 8)}...`,
    );

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
      // The from-seed path is also what POPULATES the cache: this run replays, the next resumes.
      cache ? { cache, tag: cacheTag(seeds.masterSeed, env.walletNetworkId) } : undefined,
    );
  }

  /**
   * Rebuilds the facade from cached sub-wallet states so sync resumes instead of replaying.
   * Returns `undefined` on any failure, so the caller falls back to the from-seed path.
   */
  private static async restore(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
    dustOptions: DustWalletOptions,
    cache: WalletCache,
  ): Promise<MidnightWalletProvider | undefined> {
    try {
      const seeds =
        secret.kind === 'mnemonic'
          ? WalletSeeds.fromMnemonic(secret.value)
          : WalletSeeds.fromMasterSeed(secret.value);
      const tag = cacheTag(seeds.masterSeed, env.walletNetworkId);

      const states = await readCachedState(logger, cache, tag);
      if (!states) return undefined;

      const config = walletConfiguration(env);
      const dustConfig = {
        ...config,
        costParameters: {
          ledgerParams: dustOptions.ledgerParams,
          additionalFeeOverhead: dustOptions.additionalFeeOverhead,
          feeBlocksMargin: dustOptions.feeBlocksMargin,
        },
      };

      const keystore = createKeystore(seeds.unshielded, env.walletNetworkId);
      const shielded = ShieldedWallet(config).restore(states.shielded);
      const unshielded = UnshieldedWallet(config).restore(states.unshielded);
      const dust = DustWallet(dustConfig).restore(states.dust);

      const wallet = (await WalletFacadeClass.init({
        configuration: { ...config, ...dustConfig },
        shielded: () => shielded,
        unshielded: () => unshielded,
        dust: () => dust,
      })) as WalletFacade;

      logger.info(`Wallet restored from sync cache ${cache.dir}; resuming instead of replaying.`);
      return new MidnightWalletProvider(
        logger,
        wallet,
        ZswapSecretKeys.fromSeed(seeds.shielded),
        DustSecretKey.fromSeed(seeds.dust),
        keystore,
        { cache, tag },
      );
    } catch (error) {
      // A cache written by an older SDK, a truncated file, a changed config shape: all mean
      // "build it from the seed instead", never "fail the command".
      logger.warn(
        `Could not restore the wallet sync cache, building from seed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }
}

/**
 * Wallet sync cache.
 *
 * `FluentWalletBuilder` can only build a wallet from a seed, and a from-seed wallet starts at
 * `appliedIndex === 0`, which makes the indexer stream every event from the beginning. On
 * Preview that measured ~12 minutes, on EVERY command, dwarfing proving (27s) and confirmation
 * (1.4s).
 *
 * The sub-wallets support `serializeState()` / `restore()`, and sync resumes from
 * `appliedIndex - 1` for a restored wallet, so persisting the three states across runs turns a
 * full replay into a catch-up. This mirrors `provideWallet` in the upstream
 * `wallet-sdk-testkit`, including its rule that all three sub-wallets and the facade must share
 * ONE `txHistoryStorage` - otherwise shielded/unshielded writes go to a storage the facade
 * never reads.
 *
 * Restore is strictly best-effort: any missing file, parse failure or construction error falls
 * back to the from-seed build, which is exactly the behaviour before this cache existed. A
 * stale cache costs a slow run, never a wrong balance - the restored wallet still syncs to the
 * tip before `syncWallet` reports it complete.
 */
const CACHE_PARTS = ['shielded', 'unshielded', 'dust'] as const;
type CachePart = (typeof CACHE_PARTS)[number];

export type WalletCache = {
  /** Directory holding the three serialized sub-wallet states. */
  readonly dir: string;
};

/** Keyed by wallet identity and network, so one cache cannot be read back for another wallet. */
function cacheTag(masterSeed: string, networkId: unknown): string {
  return createHash('sha256').update(`${masterSeed}:${String(networkId)}`).digest('hex').slice(0, 16);
}

function cacheFile(cache: WalletCache, tag: string, part: CachePart): string {
  return path.join(cache.dir, `${tag}-${part}.state`);
}

/** The configuration `mapEnvironmentToConfiguration` builds inside testkit, which is not exported. */
function walletConfiguration(env: EnvironmentConfiguration) {
  return {
    indexerClientConnection: {
      indexerHttpUrl: env.indexer,
      indexerWsUrl: env.indexerWS,
    },
    provingServerUrl: new URL(env.proofServer),
    networkId: env.walletNetworkId,
    relayURL: new URL(env.nodeWS),
    // One shared instance across all three sub-wallets and the facade. See the note above.
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    costParameters: { feeBlocksMargin: 5 },
  };
}

async function readCachedState(
  logger: Logger,
  cache: WalletCache,
  tag: string,
): Promise<Record<CachePart, string> | undefined> {
  try {
    const entries = await Promise.all(
      CACHE_PARTS.map(async (part) => [part, await readFile(cacheFile(cache, tag, part), 'utf8')] as const),
    );
    return Object.fromEntries(entries) as Record<CachePart, string>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A first run has no cache; that is the normal path, not a problem worth reporting loudly.
    logger.info(
      code === 'ENOENT'
        ? 'No wallet sync cache; building from seed and syncing from the start.'
        : `Ignoring unreadable wallet sync cache: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Persists the three sub-wallet states. Call only after the wallet has reached a synced state -
 * writing mid-sync would cache a position the wallet had not actually applied.
 *
 * Writes to a temporary file and renames, because a torn state file is worse than none: it
 * would restore, look valid, and resume from a position the wallet never reached.
 */
export async function saveWalletSyncState(
  logger: Logger,
  wallet: WalletFacade,
  cache: WalletCache,
  tag: string,
): Promise<void> {
  try {
    await mkdir(cache.dir, { recursive: true });
    const states: Record<CachePart, string> = {
      shielded: await wallet.shielded.serializeState(),
      unshielded: await wallet.unshielded.serializeState(),
      dust: await wallet.dust.serializeState(),
    };
    await Promise.all(
      CACHE_PARTS.map(async (part) => {
        const target = cacheFile(cache, tag, part);
        const temporary = `${target}.tmp`;
        await writeFile(temporary, states[part], { mode: 0o600 });
        await rename(temporary, target);
      }),
    );
    logger.info(`Wallet sync state cached in ${cache.dir}`);
  } catch (error) {
    // Never fail a completed operation because the cache could not be written.
    logger.warn(`Could not cache wallet sync state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

// Renders sync status as "<complete> (n/m)" where n is the applied index and
// m is the target the wallet must reach for isStrictlyComplete() to be true.
// Shielded/dust progress uses appliedIndex/highestRelevantWalletIndex; the
// unshielded wallet uses appliedId/highestTransactionId.
function formatProgress(progress: unknown): string {
  const complete = isProgressStrictlyComplete(progress);
  if (!progress || typeof progress !== 'object') {
    return `${complete}`;
  }
  const p = progress as {
    appliedIndex?: bigint;
    highestRelevantWalletIndex?: bigint;
    appliedId?: bigint;
    highestTransactionId?: bigint;
  };
  const applied = p.appliedIndex ?? p.appliedId;
  const target = p.highestRelevantWalletIndex ?? p.highestTransactionId;
  if (applied === undefined || target === undefined) {
    return `${complete}`;
  }
  return `${complete} (${applied}/${target})`;
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  const synced = wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.state.progress);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${formatProgress(state.shielded.state.progress)}, ` +
            `unshielded=${formatProgress(state.unshielded.progress)}, dust=${formatProgress(state.dust.state.progress)}`,
        );
        if (!shielded) {
          logger.debug(`  shielded.progress: ${JSON.stringify(state.shielded.state.progress)}`);
        }
        if (!unshielded) {
          logger.debug(`  unshielded.progress: ${JSON.stringify(state.unshielded.progress)}`);
        }
        if (!dust) {
          logger.debug(`  dust.progress: ${JSON.stringify(state.dust.state.progress)}`);
        }
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
  );

  // A TOTAL deadline, not an inter-emission one.
  //
  // This used to be `Rx.timeout({ each: timeout })`, which only fires when emissions STOP.
  // When a sub-wallet's sync fiber dies - a transient indexer WebSocket error is enough, and
  // one was observed against Preview as `Wallet.Sync: [object ErrorEvent]` from
  // wallet-sdk-dust-wallet - the facade keeps emitting state that never becomes strictly
  // complete. Emissions continue, so `each` never fires, and the caller waits forever. With
  // the CLI's one-hour default that is indistinguishable from a hang.
  const deadline = Rx.timer(timeout).pipe(
    Rx.map<number, never>(() => {
      throw new Error(
        `Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received). ` +
          'The wallet kept reporting progress but never reached a synced state; a sub-wallet ' +
          'sync may have failed. Retry, or raise MIDNIGHT_SYNC_TIMEOUT_MS.',
      );
    }),
  );

  return Rx.firstValueFrom(Rx.race(synced, deadline));
}