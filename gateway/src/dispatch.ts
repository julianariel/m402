import { readFileSync } from 'node:fs';
import { PAYMENT_HEADER, type Service } from '@m402/shared';
import { createWalletClient, http, publicActions, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { wrapFetchWithPayment } from 'x402-fetch';
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

export async function dispatchOrigin(service: Service, req: Request, timeoutMs = 10_000): Promise<Response> {
  const incoming = new URL(req.url);
  const suffix = incoming.pathname.replace(/^\/s\/[^/]+/, '');
  const target = new URL(service.target);
  target.pathname = target.pathname.replace(/\/$/, '') + suffix;
  target.search = incoming.search;

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

// The relayer is a trusted operator fronting USDC on the agent's behalf —
// this is the one place in the gateway that signs and spends, and it is
// scoped to exactly that: viem's client here has no access to vault funds.
export function createRelayDispatcher(relayerKeyFile: string, maxPayment = 100_000n): Dispatch {
  let cachedKey: `0x${string}` | undefined;

  return async function dispatchRelay(service, req) {
    if (!service.chain) throw new Error(`relay service ${service.id} is missing chain`);
    const chain = chainFromCaip2(service.chain);
    cachedKey ??= loadRelayerPrivateKey(relayerKeyFile);
    const account = privateKeyToAccount(cachedKey);
    // x402-fetch's Signer type needs both wallet and public actions on one
    // client — .extend(publicActions) is viem's documented way to combine them.
    const walletClient = createWalletClient({ account, chain, transport: http() }).extend(publicActions);
    const payFetch = wrapFetchWithPayment(fetch, walletClient, maxPayment);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    // x402-fetch retries after the initial 402, so the body must be reusable.
    const body = hasBody ? await req.arrayBuffer() : undefined;

    try {
      const upstream = await payFetch(service.target, {
        method: req.method,
        headers: headersForUpstream(req),
        body,
      });
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
