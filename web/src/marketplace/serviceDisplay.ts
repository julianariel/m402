import { USD_TO_STAR_RATE } from '@m402/shared';
import type { GatewayServiceRow } from '../lib/gateway';

export function shortHex(hex: string, head = 10, tail = 4): string {
  return hex.length > head + tail + 1 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex;
}

/** Registration converts USD -> STAR once, at a fixed public rate (usdToStar in @m402/shared).
 * This is the exact inverse of that conversion, not an estimate — the on-chain price is the
 * source of truth; USD is display-only and was always allowed to drift from it. */
export function approxUsdOf(row: Pick<GatewayServiceRow, 'price'>): string {
  const usd = Number(row.price) / USD_TO_STAR_RATE;
  return usd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** target isn't guaranteed to be a parseable absolute URL — merchants type it into a plain
 * text input (PublishScreen) and the gateway only checks it's a string, not that it's a valid
 * URL — so `new URL(target)` isn't safe to call unguarded anywhere it's rendered. */
export function safeHostname(target: string): string {
  try {
    return new URL(target).hostname;
  } catch {
    return target;
  }
}

/** The registry has no display name — only id/price/owner/type/target/chain (docs/design.md#5).
 * The origin/relay target's hostname is the closest thing to a human label that's actually real. */
export function labelOf(row: Pick<GatewayServiceRow, 'target'>): string {
  return safeHostname(row.target);
}
