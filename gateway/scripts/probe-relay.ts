/**
 * Drives createRelayDispatcher against ONE real x402 service and reports whether
 * USDC actually moved. No gateway, no vault, no Midnight — this isolates the leg
 * that has never been exercised.
 *
 * This SPENDS testnet USDC from gateway/relayer.key. Keep TARGET cheap.
 *
 *   npx tsx scripts/probe-relay.ts [registered-target] [caller-suffix]
 *
 * The second argument is what an agent appends to /s/<id> — a path suffix, a query
 * string, or both. It exercises the same URL building the running gateway does.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createRelayDispatcher } from '../src/dispatch.js';

const TARGET = process.argv[2] ?? 'https://tollbooth-hello-testnet.sjwilliams8.workers.dev/hello';
const SUFFIX = process.argv[3] ?? '';
const KEY_FILE = process.env.RELAYER_KEY_FILE ?? './relayer.key';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

const balanceOf = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const relayer = privateKeyToAccount(readFileSync(KEY_FILE, 'utf8').trim() as `0x${string}`).address;
const chain = createPublicClient({ chain: baseSepolia, transport: http() });
const usdc = () => chain.readContract({ address: USDC, abi: balanceOf, functionName: 'balanceOf', args: [relayer] });

console.log('relayer :', relayer);
console.log('target  :', TARGET);
console.log('suffix  :', SUFFIX || '(none)');

const before = await usdc();
console.log('USDC before:', formatUnits(before, 6));

const dispatch = createRelayDispatcher(KEY_FILE, 10_000n); // cap at 0.01 USDC
const started = Date.now();
const res = await dispatch(
  { id: 'probe', price: 0n, owner: 'probe', type: 'relay', target: TARGET, chain: 'eip155:84532' },
  new Request(`http://gateway.local/s/probe${SUFFIX}`),
);
const elapsed = Date.now() - started;

console.log(`\nstatus  : ${res.status}  (${elapsed} ms)`);
console.log('body    :', (await res.text()).slice(0, 400));

// Settlement is asynchronous on the facilitator's side; poll rather than read once.
let after = before;
for (let i = 0; i < 20 && after === before; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  after = await usdc();
}

console.log('USDC after :', formatUnits(after, 6));
const spent = before - after;
console.log(spent > 0n ? `\nPAID: ${formatUnits(spent, 6)} USDC left the relayer.` : '\nNO PAYMENT OBSERVED on-chain within 60s.');
