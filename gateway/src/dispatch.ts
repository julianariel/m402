import { readFileSync } from 'node:fs';
import { PAYMENT_HEADER, type Service } from '@m402/shared';
import { type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader, type Network, type PaymentPolicy } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import type { Dispatch } from './routes.js';

export function headersForUpstream(req: Request): Headers {
  const headers = new Headers(req.headers);
  // The Midnight receipt secret is a bearer credential for the m402 gateway,
  // never metadata for either the merchant origin or an external x402 service.
  headers.delete(PAYMENT_HEADER);
  headers.delete('host');
  return headers;
}

function proxyResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers);
  // Node fetch transparently decodes compressed bodies but retains the original
  // encoding and framing headers. Forwarding those makes downstream fetch fail.
  for (const name of [
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]) {
    headers.delete(name);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Both fulfilment paths build their upstream URL here. Keeping it in one place is the
// point: when only the origin path forwarded the path suffix and query, a relay service
// could not take a parameter at all, and the two dispatchers disagreed silently.
export function buildUpstreamUrl(target: string, requestUrl: string): URL {
  const incoming = new URL(requestUrl);
  const suffix = incoming.pathname.replace(/^\/s\/[^/]+/, '');
  const upstream = new URL(target);
  upstream.pathname = upstream.pathname.replace(/\/$/, '') + suffix;

  // Query params registered with the target are defaults; the caller's win on a collision.
  // A relay target registered as ...?location=Buenos%20Aires therefore keeps working when
  // the agent sends nothing, and the agent can still ask for a different location.
  const merged = new URLSearchParams(upstream.search);
  for (const [key, value] of incoming.searchParams) merged.set(key, value);
  upstream.search = merged.toString();

  // Assigning to .pathname cannot change the host, and the WHATWG parser resolves `..`
  // before this function is reached, so neither escape is reachable today. Asserted
  // anyway: this is the boundary between an agent-supplied string and a wallet that pays.
  const base = new URL(target);
  const basePath = base.pathname.replace(/\/$/, '');
  if (upstream.origin !== base.origin || !upstream.pathname.startsWith(basePath)) {
    throw new Error(`upstream URL ${upstream.href} escaped the registered target ${target}`);
  }

  return upstream;
}

export async function dispatchOrigin(service: Service, req: Request, timeoutMs = 10_000): Promise<Response> {
  const target = buildUpstreamUrl(service.target, req.url);

  const headers = headersForUpstream(req);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      duplex: hasBody ? 'half' : undefined,
      signal: controller.signal,
    });
    return proxyResponse(upstream);
  } catch {
    return new Response(null, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

const CHAINS_BY_EIP155_ID: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
};

export function chainFromCaip2(caip2: string): Chain {
  const [namespace, reference] = caip2.split(':');
  if (namespace !== 'eip155') throw new Error(`unsupported CAIP-2 namespace: ${namespace}`);
  const chain = CHAINS_BY_EIP155_ID[Number(reference)];
  if (!chain) throw new Error(`no viem chain wired up for eip155:${reference}`);
  return chain;
}

export function loadRelayerPrivateKey(path: string): `0x${string}` {
  const content = readFileSync(path, 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(content)) {
    throw new Error(`relayer key file ${path} does not contain a 32-byte hex private key`);
  }
  return content as `0x${string}`;
}

// x402 v2 moved the spend cap out of wrapFetchWithPayment and into a policy that
// filters the offers a server advertises. Anything over the cap is dropped before
// the signer ever sees it, so an expensive offer fails to select rather than paying.
// v2 offers carry `amount`; v1 offers carry `maxAmountRequired`.
export function maxPaymentPolicy(maxPayment: bigint): PaymentPolicy {
  return (_x402Version, requirements) =>
    requirements.filter((r) => {
      const raw = (r as { amount?: string; maxAmountRequired?: string }).amount ?? (r as { maxAmountRequired?: string }).maxAmountRequired;
      if (raw === undefined) return false;
      try {
        return BigInt(raw) <= maxPayment;
      } catch {
        return false;
      }
    });
}

// The relayer is a trusted operator fronting USDC on the agent's behalf —
// this is the one place in the gateway that signs and spends, and it is
// scoped to exactly that: the signer here has no access to vault funds.
export function createRelayDispatcher(relayerKeyFile: string, maxPayment = 100_000n): Dispatch {
  let cachedKey: `0x${string}` | undefined;

  return async function dispatchRelay(service, req) {
    if (!service.chain) throw new Error(`relay service ${service.id} is missing chain`);
    // Not used to build a transport any more — kept as the gate that rejects a
    // chain we have not deliberately wired up, before any key is loaded.
    chainFromCaip2(service.chain);
    cachedKey ??= loadRelayerPrivateKey(relayerKeyFile);
    const account = privateKeyToAccount(cachedKey);

    // `networks` is deliberately the single declared chain. Left unset,
    // registerExactEvmScheme registers the eip155:* wildcard, and a service that
    // advertises a mainnet offer would be payable with real funds.
    const client = new x402Client();
    registerExactEvmScheme(client, {
      signer: account,
      networks: [service.chain as Network],
      policies: [maxPaymentPolicy(maxPayment)],
    });

    const payFetch = wrapFetchWithPayment(fetch, client);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    // The client retries after the initial 402, so the body must be reusable.
    const body = hasBody ? await req.arrayBuffer() : undefined;
    // Same builder as the origin path: the agent's path suffix and query reach the
    // external service, contained to the registered target. A query param can change
    // what the service quotes, which is what maxPaymentPolicy bounds.
    const target = buildUpstreamUrl(service.target, req.url);

    try {
      const upstream = await payFetch(target, {
        method: req.method,
        headers: headersForUpstream(req),
        body,
      });
      // The settlement header is the only proof a payment actually cleared. A 200
      // on its own does not distinguish a settled call from a server that skipped it.
      const settlement = upstream.headers.get('payment-response') ?? upstream.headers.get('x-payment-response');
      if (settlement) {
        try {
          console.log('relay settled', { serviceId: service.id, settlement: decodePaymentResponseHeader(settlement) });
        } catch {
          console.log('relay settled, undecodable header', { serviceId: service.id });
        }
      }
      return proxyResponse(upstream);
    } catch (err) {
      console.error('relay dispatch failed after a possible USDC payment — absorbed as relayer loss', {
        serviceId: service.id,
        target: service.target,
        error: err,
      });
      return new Response(null, { status: 502 });
    }
  };
}

export function createDispatch(dispatchOriginFn: Dispatch, dispatchRelayFn: Dispatch): Dispatch {
  return (service, req) => (service.type === 'origin' ? dispatchOriginFn(service, req) : dispatchRelayFn(service, req));
}
