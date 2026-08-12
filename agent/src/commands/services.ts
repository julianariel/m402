import type { Service } from '@m402/shared';
import { requireVaultAddress, type AgentConfig } from '../config.js';
import { CliError } from '../errors.js';
import type { Output } from '../output.js';

export type ServicesOptions = {
  type?: 'origin' | 'relay';
};

export type ServiceListingRow = {
  id: string;
  price: string;
  type: 'origin' | 'relay';
  target: string;
  chain?: string;
  description?: string;
  /** Copy-paste next step: `m402 call <callUrl>`. */
  callUrl: string;
  /** False when the id is missing on-chain, or the gateway's price doesn't match it. */
  priceVerified: boolean;
  priceWarning?: string;
};

async function fetchGatewayServices(gatewayUrl: string): Promise<Service[]> {
  const response = await fetch(`${gatewayUrl}/services`);
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(`Gateway request failed with HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  const rows = (await response.json()) as Array<Omit<Service, 'price'> & { price: string }>;
  return rows.map((r) => ({ ...r, price: BigInt(r.price) }));
}

/**
 * Pure, so it's testable without a gateway or a chain: takes what `servicesCommand` fetched,
 * not how it fetched it. `assertExpectedPrice` is injected rather than imported here so this
 * module stays free of `contracts/*` at the top level — `services.ts` is imported statically
 * by `index.ts`, and a top-level `contracts` import would cost every invocation, including
 * `--version` (see `commands/client.ts`).
 */
export function buildServiceRows(
  gatewayServices: readonly Service[],
  onChainServices: ReadonlyArray<{ id: string; price: bigint }>,
  gatewayUrl: string,
  assertExpectedPrice: (expectedPrice: bigint, registeredPrice: bigint) => void,
  options: ServicesOptions = {},
): ServiceListingRow[] {
  const onChainPriceById = new Map(onChainServices.map((s) => [s.id, s.price] as const));

  return gatewayServices
    .filter((service) => !options.type || service.type === options.type)
    .map((service) => {
      const onChainPrice = onChainPriceById.get(service.id);
      let priceVerified = false;
      let priceWarning: string | undefined;
      if (onChainPrice === undefined) {
        priceWarning = 'Not found on-chain for this vault — may be unconfirmed, or a stale/fake gateway entry.';
      } else {
        try {
          assertExpectedPrice(service.price, onChainPrice);
          priceVerified = true;
        } catch (error) {
          priceWarning = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        id: service.id,
        price: service.price.toString(),
        type: service.type,
        target: service.target,
        chain: service.chain,
        description: service.description,
        callUrl: `${gatewayUrl}/s/${service.id}`,
        priceVerified,
        priceWarning,
      };
    });
}

export async function servicesCommand(
  config: AgentConfig,
  output: Output,
  options: ServicesOptions = {},
): Promise<void> {
  const vaultAddress = requireVaultAddress(config);
  const { readVaultState, assertExpectedPrice } = await import('contracts/inspect-vault');

  const [gatewayServices, chainState] = await Promise.all([
    fetchGatewayServices(config.gatewayUrl),
    readVaultState(vaultAddress, config.networkConfig),
  ]);

  const rows = buildServiceRows(
    gatewayServices,
    chainState?.services ?? [],
    config.gatewayUrl,
    assertExpectedPrice,
    options,
  );

  if (output.options.json) {
    output.data(rows);
    return;
  }

  if (!rows.length) {
    output.info(
      options.type ? `No ${options.type} services registered.` : 'No services registered on this gateway.',
    );
    return;
  }

  output.info(`Services (${rows.length})`);
  for (const row of rows) {
    const desc = row.description ? ` — ${row.description}` : '';
    output.info(`  ${row.id.slice(0, 16)}...  ${row.price} STAR  ${row.type}${desc}`);
    if (!row.priceVerified) output.warn(`    WARNING: ${row.priceWarning}`);
    output.info(`    ${row.callUrl}`);
  }
}

export function parseServiceType(value: string | undefined): 'origin' | 'relay' | undefined {
  if (value === undefined) return undefined;
  if (value === 'origin' || value === 'relay') return value;
  throw new CliError(`Unknown service type '${value}'. Supported: origin, relay.`, 2);
}
