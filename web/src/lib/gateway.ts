import { PAYMENT_HEADER, type PaymentRequired, type Service } from '@m402/shared';
import { GATEWAY_URL } from '../chain/config';

export type GatewayServiceRow = {
  id: string;
  price: bigint;
  owner: string;
  type: 'origin' | 'relay';
  target: string;
  chain?: string;
  description?: string;
};

function serviceUrl(id: string, path = ''): string {
  return `${GATEWAY_URL}/s/${id}${path}`;
}

async function describeFailure(response: Response): Promise<Error> {
  const detail = (await response.text()).trim();
  const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
  return new Error(`Gateway request failed with HTTP ${response.status}${suffix}`);
}

/** GET /services — the gateway's own registry. Per docs/design.md#6, every row here is
 * already chain-confirmed (ownership.ts rejects a POST /services whose registerService hasn't
 * landed), so there's no "confirming" state to badge — everything listed is live. */
export async function listServices(): Promise<GatewayServiceRow[]> {
  const res = await fetch(`${GATEWAY_URL}/services`);
  if (!res.ok) throw await describeFailure(res);
  const rows = (await res.json()) as Array<Omit<GatewayServiceRow, 'price'> & { price: string }>;
  return rows.map((r) => ({ ...r, price: BigInt(r.price) }));
}

/** POST /services — registers the gateway-side routing row for a serviceId that has already
 * confirmed on-chain (see chain/circuits.ts's registerServiceOnChain). The gateway independently
 * re-derives ownership from the indexer before accepting this, so a lie about `owner` is
 * rejected regardless of what's sent here. */
export async function registerGatewayService(service: Service): Promise<'created' | 'conflict'> {
  const res = await fetch(`${GATEWAY_URL}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...service, price: service.price.toString() }),
  });
  if (res.status === 201) return 'created';
  if (res.status === 409) return 'conflict';
  if (res.status === 503) throw new Error('registration-not-yet-confirmed');
  if (res.status === 403) throw new Error('owner-mismatch');
  throw await describeFailure(res);
}

export type InitialRequest =
  | { kind: 'resource'; response: Response }
  | { kind: 'payment-required'; requirements: PaymentRequired };

/** GET /s/:id with no X-Payment — either the resource (already paid this session, unlikely for
 * a fresh browser tab) or a 402 with the price/vault to pay. */
export async function requestService(id: string): Promise<InitialRequest> {
  const response = await fetch(serviceUrl(id));
  if (response.status === 402) {
    const body = (await response.json()) as PaymentRequired;
    return { kind: 'payment-required', requirements: body };
  }
  if (!response.ok) throw await describeFailure(response);
  return { kind: 'resource', response };
}

const CLAIM_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Retries GET /s/:id with X-Payment until the gateway's indexer subscription observes the
 * receipt (verify.ts's ~60s window) or the retry budget above (~60s total) runs out. */
export async function claimService(
  id: string,
  receiptSecretHex: string,
  onRetry?: (delayMs: number, attempt: number) => void,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(serviceUrl(id), {
      headers: { [PAYMENT_HEADER]: receiptSecretHex },
      redirect: 'manual',
    });
    if (response.status !== 402) {
      if (!response.ok) throw await describeFailure(response);
      return response;
    }
    const delay = CLAIM_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      throw new Error('Payment confirmed, but the gateway has not observed the receipt yet. Try again shortly.');
    }
    onRetry?.(delay, attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
