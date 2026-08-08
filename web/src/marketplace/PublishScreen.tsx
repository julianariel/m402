import { useState } from 'react';
import { usdToStar } from '@m402/shared';
import { Badge, Button, Card } from '../components/core';
import { Checkbox, Field, Input, Select } from '../components/forms';
import { CodeBlock, HashChip, PriceTag } from '../components/protocol';
import { useWalletContext } from '../wallet/WalletContext';

export interface PublishScreenProps {
  onDone: () => void;
}

interface RegisteredService {
  id: string;
  slug: string;
  signature: string;
  verifyingKey: string;
}

export function PublishScreen({ onDone }: PublishScreenProps) {
  const { connected, api, connect } = useWalletContext();
  const [type, setType] = useState<'origin' | 'relay'>('origin');
  const [url, setUrl] = useState('https://api.example.com/weather');
  const [name, setName] = useState('Global weather');
  const [price, setPrice] = useState('0.01');
  const [chain, setChain] = useState('eip155:8453');
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<RegisteredService | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const star = usdToStar(parseFloat(price) || 0).toString();

  async function handleSign() {
    setSigning(true);
    setSignError(null);
    try {
      const wallet = api ?? (await connect());
      const message = [
        'm402 register service',
        `name: ${name}`,
        `fulfilment: ${type}`,
        `target: ${url}`,
        `price: ${price} USD (${star} STAR)`,
      ].join('\n');
      const sig = await wallet.signData(message, { encoding: 'text', keyType: 'unshielded' });
      setResult({
        id: '0x' + Math.random().toString(16).slice(2, 10) + 'de0c5518a3ff90b2e6d1c49f2c',
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        signature: sig.signature,
        verifyingKey: sig.verifyingKey,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setSignError(code === 'Rejected' ? 'Signature request rejected in Lace.' : err instanceof Error ? err.message : 'Signing failed.');
    } finally {
      setSigning(false);
    }
  }

  return (
    <div style={{ maxWidth: 'var(--container-md)', margin: '0 auto', padding: '40px var(--page-pad) 80px' }}>
      <h1 style={{ margin: 0, font: 'var(--text-h1)', letterSpacing: 'var(--ls-heading)' }}>Publish a service</h1>
      <p style={{ margin: 'var(--space-3) 0 var(--space-8)', maxWidth: '58ch', font: 'var(--text-body)', color: 'var(--text-secondary)' }}>
        Register any HTTP API with a price and get back a wrapped URL that speaks the x402 flow. You sign the registration yourself — the gateway never holds your keys.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-6)', alignItems: 'start' }}>
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
            <Field label="Service name" required><Input value={name} onChange={setName} /></Field>
            <Field
              label={type === 'relay' ? 'x402 service URL' : 'Origin URL'} required
              hint={type === 'relay' ? 'The relayer fronts USDC and is reimbursed from the vault.' : 'Health-checked before every 402 is issued.'}
            >
              <Input mono value={url} onChange={setUrl} />
            </Field>
            {type === 'relay' && (
              <Field label="Chain" hint="CAIP-2 identifier. Selects the viem client.">
                <Select value={chain} onChange={setChain} options={[{ value: 'eip155:8453', label: 'Base — eip155:8453' }, { value: 'eip155:1', label: 'Ethereum — eip155:1' }]} />
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
                <Button size="lg" disabled={!ack} loading={signing} iconLeft="wallet" onClick={handleSign}>
                  {connected ? 'Sign with Lace' : 'Connect & sign with Lace'}
                </Button>
                <Button size="lg" variant="ghost" onClick={onDone}>Cancel</Button>
              </div>
              {signError && (
                <span style={{ font: 'var(--fw-regular) var(--fs-caption)/1.3 var(--font-body)', color: 'var(--state-error)' }}>
                  {signError}
                </span>
              )}
            </div>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ? (
            <Card padding="md" accent="pending">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <Badge tone="pending" icon="check">signed</Badge>
                <div style={{ font: 'var(--text-code)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>https://gw.m402.dev/s/{result.slug}</div>
                <HashChip label="serviceid" value={result.id} tone="public" />
                <HashChip label="signature" value={result.signature} tone="private" />
                <HashChip label="signer" value={result.verifyingKey} tone="private" />
                <div style={{ font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                  Lace signed this registration with your unshielded key. Submitting it on-chain needs the gateway's <code style={{ fontFamily: 'var(--font-mono)' }}>registerService</code> endpoint, which isn't deployed yet.
                </div>
                <Button variant="secondary" size="sm" onClick={onDone}>Back to explorer</Button>
              </div>
            </Card>
          ) : (
            <Card padding="md" tone="inset">
              <div style={{ font: 'var(--fw-bold) var(--fs-mono-xs)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 'var(--space-3)' }}>preview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ font: 'var(--fw-medium) var(--fs-body)/1.2 var(--font-body)' }}>{name || 'Untitled service'}</div>
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
