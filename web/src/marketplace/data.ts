import { usdToStar } from '@m402/shared';

export interface Service {
  id: string;
  slug: string;
  name: string;
  type: 'origin' | 'relay';
  chain?: string;
  target: string;
  usd: string;
  star: string;
  calls: string;
  state: 'live' | 'confirming';
  desc: string;
}

/** usd is the display figure; star is derived from the one shared conversion rate. */
const RAW: Array<Omit<Service, 'star'>> = [
  { id: '0x41ab77de0c5518a3ff90b2e6d1c49f2c', slug: 'weather-api', name: 'Global weather', type: 'origin', target: 'https://api.example.com/weather', usd: '0.01', calls: '1,284', state: 'live', desc: 'Current conditions and 7-day forecast for any lat/lon.' },
  { id: '0x77de0c5518a3ff90b2e6d1c49f2c41ab', slug: 'sec-filings', name: 'SEC filings search', type: 'origin', target: 'https://api.example.com/edgar', usd: '0.05', calls: '312', state: 'live', desc: 'Full-text search across EDGAR filings since 2001.' },
  { id: '0x0c5518a3ff90b2e6d1c49f2c41ab77de', slug: 'base-price-feed', name: 'Base price feed', type: 'relay', chain: 'eip155:8453', target: 'https://x402.example/price', usd: '0.02', calls: '96', state: 'live', desc: 'Relayed x402 service on Base. Paid in USDC by the relayer.' },
  { id: '0x18a3ff90b2e6d1c49f2c41ab77de0c55', slug: 'llm-embeddings', name: 'Embeddings', type: 'origin', target: 'https://api.example.com/embed', usd: '0.004', calls: '8,940', state: 'live', desc: '1536-dim text embeddings, batched.' },
  { id: '0xff90b2e6d1c49f2c41ab77de0c5518a3', slug: 'onchain-labels', name: 'Address labels', type: 'relay', chain: 'eip155:8453', target: 'https://x402.example/labels', usd: '0.03', calls: '41', state: 'confirming', desc: 'Entity labels for EVM addresses. Registered 2 minutes ago.' },
];

export const SERVICES: Service[] = RAW.map((s) => ({ ...s, star: usdToStar(parseFloat(s.usd)).toString() }));
