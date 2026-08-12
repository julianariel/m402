import { useState } from 'react';
import { usdToStar } from '@m402/shared';
import { Badge, Button, Card, StatusDot } from '../components/core';
import { Checkbox, Field, Input, Select } from '../components/forms';
import { CodeBlock, HashChip, PriceTag } from '../components/protocol';
import { useWalletContext } from '../wallet/WalletContext';
import { registerServiceOnChain, type TxPhase } from '../chain/circuits';
import { registerGatewayService } from '../lib/gateway';
import { GATEWAY_URL } from '../chain/config';
import { VAULT_ADDRESS } from '../lib/vault';
import { safeHostname } from './serviceDisplay';
import { useNarrow } from '../lib/useNarrow';

export interface PublishScreenProps {
  onDone: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: TxPhase }
  | { kind: 'gateway' }
  | { kind: 'done'; txId: string }
  | { kind: 'error'; message: string };

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function PublishScreen({ onDone }: PublishScreenProps) {
  const wallet = useWalletContext();
  const narrow = useNarrow();
  const [type, setType] = useState<'origin' | 'relay'>('origin');
  const [url, setUrl] = useState('https://api.example.com/weather');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.01');
  // Testnet by default: the relayer holds Base Sepolia USDC only, and defaulting to
  // mainnet made every relay registration land on a chain it cannot pay on.
  const [chain, setChain] = useState('eip155:84532');
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Set the instant serviceId is known (see chain/circuits.ts's onServiceId) — before proving
  // even starts, well before `phase` reaches 'done'. Independent state because it must survive
  // the transition through 'proving' / 'confirming' / 'gateway' unchanged.
  const [serviceIdHex, setServiceIdHex] = useState<string | null>(null);

  const star = usdToStar(parseFloat(price) || 0).toString();
  const busy = phase.kind !== 'idle' && phase.kind !== 'done' && phase.kind !== 'error';

  async function handlePublish() {
    setServiceIdHex(null);
    setPhase({ kind: 'connecting' });
    try {
      const priceStar = usdToStar(parseFloat(price) || 0);
      if (priceStar <= 0n) throw new Error('Price must be greater than $0.');
      if (type === 'relay' && !chain) throw new Error('Select a chain for a relay service.');

      const { providers } = wallet.connected && wallet.providers && wallet.ownerBytes
        ? { providers: wallet.providers }
        : await wallet.connect();
      const owner = wallet.ownerBytes;
      if (!owner) throw new Error('Could not read the connected wallet address.');

      const salt = crypto.getRandomValues(new Uint8Array(32));
      // registerServiceOnChain calls onServiceId synchronously, before proving starts, so the
      // wrapped URL below appears immediately — badged "confirming" — while the transaction
      // proves and confirms in the background (~22-28s on Preview).
      let confirmedServiceIdHex = '';
      const { txId } = await registerServiceOnChain(
        providers,
        VAULT_ADDRESS,
        { salt, price: priceStar, owner },
        (p) => setPhase({ kind: p }),
        (id) => {
          confirmedServiceIdHex = hex(id);
          setServiceIdHex(confirmedServiceIdHex);
        },
      );

      setPhase({ kind: 'gateway' });
      // registerService just confirmed, but the gateway's own ownership check re-queries the
      // indexer independently (ownership.ts) — it can briefly lag behind watchForTxData. Retry.
      const gatewayRetryDelaysMs = [1_000, 2_000, 4_000, 8_000];
      for (let attempt = 0; ; attempt++) {
        try {
          await registerGatewayService({
            id: confirmedServiceIdHex,
            price: priceStar,
            owner: hex(owner),
            type,
            target: url,
            chain: type === 'relay' ? chain : undefined,
            description: description.trim() || undefined,
          });
          break;
        } catch (err) {
          const retryable = err instanceof Error && err.message === 'registration-not-yet-confirmed';
          const delay = gatewayRetryDelaysMs[attempt];
          if (!retryable || delay === undefined) throw err;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setPhase({ kind: 'done', txId });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Registration failed.' });
    }
  }

  const buttonLabel =
    phase.kind === 'connecting' ? 'Connecting wallet…'
    : phase.kind === 'proving' ? 'Proving registerService…'
    : phase.kind === 'confirming' ? 'Confirming on-chain…'
    : phase.kind === 'gateway' ? 'Registering with gateway…'
    : wallet.connected ? 'Register with Lace'
    : 'Connect & register with Lace';

  return (
    <div style={{ maxWidth: 'var(--container-md)', margin: '0 auto', padding: '40px var(--page-pad) 80px' }}>
      <h1 style={{ margin: 0, font: 'var(--text-h1)', letterSpacing: 'var(--ls-heading)' }}>Publish a service</h1>
      <p style={{ margin: 'var(--space-3) 0 var(--space-8)', maxWidth: '58ch', font: 'var(--text-body)', color: 'var(--text-secondary)' }}>
        Register any HTTP API with a price and get back a wrapped URL that speaks the x402 flow. You sign the registration yourself — the gateway never holds your keys.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '1fr 300px', gap: 'var(--space-6)', alignItems: 'start' }}>
        <Card padding="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Field label="Fulfilment" hint="Origin proxies to your API. Relay pays an existing x402 service on an EVM chain.">
              <Select
                value={type} onChange={(v) => setType(v as 'origin' | 'relay')}
                options={[
                  { value: 'origin', label: 'Origin API — proxy to my URL' },
                  { value: 'relay', label: 'EVM relay — pay an x402 service' },
                ]}
              />
            </Field>
            <Field
              label={type === 'relay' ? 'x402 service URL' : 'Origin URL'} required
              hint={type === 'relay' ? 'The relayer fronts USDC and is reimbursed from the vault.' : 'Health-checked before every 402 is issued.'}
            >
              <Input mono value={url} onChange={setUrl} />
            </Field>
            <Field
              label="Description" hint="Shown to agents deciding whether to buy. Off-chain — not verified by the chain, and you can change it later."
            >
              <Input value={description} onChange={setDescription} maxLength={256} placeholder="Current weather by city name." />
            </Field>
            {/* Only the two chains the gateway accepts (routes.ts SUPPORTED_RELAY_CHAINS).
                Ethereum mainnet used to be offered here and could never work: the gateway
                rejects it with unsupported-relay-chain and chainFromCaip2 throws on it. */}
            {type === 'relay' && (
              <Field label="Chain" hint="CAIP-2 identifier. Selects the network the relayer pays on.">
                <Select value={chain} onChange={setChain} options={[{ value: 'eip155:84532', label: 'Base Sepolia — eip155:84532 (testnet)' }, { value: 'eip155:8453', label: 'Base — eip155:8453 (mainnet)' }]} />
              </Field>
            )}
            <Field label="Price (USD)" required hint={`Converted once, at registration, at a fixed rate → ${star} STAR. The on-chain price is fixed; the USD figure drifts.`}>
              <Input mono prefix="$" suffix={star + ' STAR'} value={price} onChange={setPrice} />
            </Field>
            <Checkbox
              checked={ack} onChange={setAck}
              label="I understand registration is first-come and immutable"
              description="serviceId and owner cannot be changed afterwards. Payouts go to the Lace address recorded now."
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 4 }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <Button size="lg" disabled={!ack} loading={busy} iconLeft="wallet" onClick={handlePublish}>
                  {buttonLabel}
                </Button>
                <Button size="lg" variant="ghost" onClick={onDone}>Cancel</Button>
              </div>
              {phase.kind === 'error' && (
                <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)' }}>
                  {phase.message}
                </span>
              )}
            </div>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {serviceIdHex ? (
            <Card padding="md" accent={phase.kind === 'done' ? 'private' : phase.kind === 'error' ? undefined : 'pending'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <StatusDot
                  tone={phase.kind === 'done' ? 'live' : phase.kind === 'error' ? 'error' : 'confirming'}
                  label={phase.kind === 'done' ? 'live' : phase.kind === 'error' ? 'registration failed' : 'confirming on-chain…'}
                />
                <div style={{ font: 'var(--text-code)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                  {GATEWAY_URL}/s/{serviceIdHex}
                </div>
                <HashChip label="serviceid" value={serviceIdHex} tone="public" />
                {phase.kind === 'done' && <HashChip label="tx" value={phase.txId} tone="public" />}
                <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                  {phase.kind === 'done'
                    ? 'registerService confirmed on-chain, and the gateway has accepted the routing entry. The wrapped URL is live.'
                    : phase.kind === 'error'
                    ? 'The URL above was derived off-chain and is still yours, but the registration transaction did not land — see the error below and retry.'
                    : 'serviceId is derived off-chain, so the URL above is already yours. registerService is proving and confirming in the background — this can take ~22-28s on Preview.'}
                </div>
                {phase.kind === 'done' && <Button variant="secondary" size="sm" onClick={onDone}>Back to explorer</Button>}
              </div>
            </Card>
          ) : (
            <Card padding="md" tone="inset">
              <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-3)' }}>preview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ font: 'var(--fw-medium) var(--fs-body)/1.2 var(--font-body)' }}>{url ? safeHostname(url) : 'Untitled service'}</div>
                <PriceTag usd={price || '0.00'} star={star} />
                {type === 'relay' ? <Badge tone="public" icon="globe">relay</Badge> : <Badge icon="server">origin</Badge>}
              </div>
            </Card>
          )}
          <CodeBlock title="registerService" code={'assert(!servicePrice.member(\n  disclose(serviceId)),\n  "already registered");'} copyable={false} />
        </div>
      </div>
    </div>
  );
}
