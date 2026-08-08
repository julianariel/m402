import type { CSSProperties, ReactNode } from 'react';
import { WaveField } from './WaveField';
import { Badge, Button, Card, Icon, TopNav } from './components';
import { FlowStep, CodeBlock } from './components/protocol';
import { WalletConnect } from './wallet/WalletConnect';
import { REPO_URL, openRepo } from './lib/links';
import { useRoute } from './router';
import { MarketplaceShell } from './marketplace/MarketplaceShell';
import { ExplorerScreen } from './marketplace/ExplorerScreen';
import { ServiceScreen } from './marketplace/ServiceScreen';
import { PublishScreen } from './marketplace/PublishScreen';
import { WithdrawScreen } from './marketplace/WithdrawScreen';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function Container({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ maxWidth: 'var(--container-lg)', margin: '0 auto', padding: '0 var(--page-pad)', ...style }}>{children}</div>;
}

function Section({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} style={{ padding: 'var(--section-y) 0', borderTop: '1px solid var(--border-subtle)', scrollMarginTop: 56 }}>
      <Container>{children}</Container>
    </section>
  );
}

function SectionHead({ n, tag, title }: { n: string; tag: string; title: string }) {
  return (
    <div style={{ paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)', marginBottom: 'var(--space-9)' }}>
      <span style={{ font: 'var(--fw-bold) var(--fs-micro)/1.6 var(--font-mono)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
        [ <span style={{ color: 'var(--accent)' }}>{n}</span> // {tag} ]
      </span>
      <h2 style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-bold) var(--fs-h2)/var(--lh-heading) var(--font-display)', letterSpacing: 'var(--ls-heading)', fontVariationSettings: '"wdth" var(--display-wdth)', color: 'var(--text-primary)' }}>
        {title}
      </h2>
    </div>
  );
}

function DisclosureRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', font: 'var(--fw-regular) var(--fs-body)/1.5 var(--font-body)', color: 'var(--text-secondary)' }}>
      <Icon name={icon} size={16} style={{ marginTop: 2, flexShrink: 0 }} />
      <span>{children}</span>
    </li>
  );
}

function RecordRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4) 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--fw-regular) var(--fs-body-sm)/1.5 var(--font-body)', color: 'var(--text-secondary)' }}>
      {children}
    </div>
  );
}

function RoadmapEntry({ title, last = false, children }: { title: string; last?: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: 'var(--space-7) 0', borderBottom: last ? 'none' : '1px solid var(--border-subtle)' }}>
      <h3 style={{ margin: 0, font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '68ch' }}>
        {children}
      </div>
    </div>
  );
}

function LimitationEntry({ icon, last = false, children }: { icon: string; last?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: 'var(--space-5) 0', borderBottom: last ? 'none' : '1px solid var(--border-subtle)' }}>
      <Icon name={icon} size={14} color="var(--text-faint)" style={{ marginTop: 3, flexShrink: 0 }} />
      <div style={{ font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>{children}</div>
    </div>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <strong style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>{children}</strong>;
}

const codeMono: CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' };
const strongMuted: CSSProperties = { fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' };
const strongSecondary: CSSProperties = { fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' };
const pBody: CSSProperties = { margin: 0, font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' };
const pNested: CSSProperties = { margin: 'var(--space-3) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' };
const olBody: CSSProperties = { margin: 0, paddingLeft: '1.3em', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' };
const olMuted: CSSProperties = { margin: 'var(--space-3) 0 0', paddingLeft: '1.3em', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' };

const HOME_ANCHORS = new Set(['what', 'compare', 'how', 'ledger', 'roadmap']);

function HomeScreen({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <WaveField />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <TopNav
          items={[
            { value: 'what', label: 'What it is' },
            { value: 'compare', label: 'x402 vs m402' },
            { value: 'how', label: 'How it works' },
            { value: 'ledger', label: 'On-chain' },
            { value: 'roadmap', label: 'Roadmap' },
            { value: 'explorer', label: 'Explorer', icon: 'globe' },
          ]}
          onNavigate={(v) => (HOME_ANCHORS.has(v) ? scrollToId(v) : navigate('/' + v))}
          network="Preview"
          networkTone="live"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
              <WalletConnect />
              <Button variant="secondary" size="sm" iconRight="external-link" onClick={() => openRepo()}>
                Repository
              </Button>
            </div>
          }
        />

        {/* Hero */}
        <section style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-11)' }}>
          <Container>
            <Badge tone="neutral">Classified · Hack Buenos Aires 2026</Badge>
            <h1 style={{
              margin: 'var(--space-6) 0 0', maxWidth: '20ch',
              font: 'var(--fw-bold) var(--fs-display-1)/var(--lh-tight) var(--font-display)',
              letterSpacing: 'var(--ls-display)', fontVariationSettings: '"wdth" var(--display-wdth)',
              color: 'var(--text-primary)',
            }}>
              Pay without publishing
            </h1>
            <p style={{
              margin: 'var(--space-7) 0 0', maxWidth: '46ch',
              font: 'var(--fw-regular) var(--fs-h4)/1.5 var(--font-body)', color: 'var(--text-secondary)',
            }}>
              x402 on Midnight — agents pay for APIs in one call, and the amount never touches the ledger.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-6)', marginTop: 'var(--space-8)', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => navigate('/explorer')}>
                Browse services
              </Button>
              <Button variant="secondary" size="lg" iconRight="external-link" onClick={() => openRepo()}>
                View on GitHub
              </Button>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-9)', flexWrap: 'wrap' }}>
              <Badge tone="neutral">Built on Midnight</Badge>
              <Badge tone="neutral">Speaks x402</Badge>
              <Badge tone="private" icon="shield-check">Amount is a witness</Badge>
              <Badge tone="public" icon="zap">~19s prove · 3.4ms verify</Badge>
            </div>
          </Container>
        </section>

        {/* 01 — What it is */}
        <Section id="what">
          <SectionHead n="01" tag="what it is" title="What m402 does" />
          <p style={{
            margin: 0, maxWidth: '26ch',
            font: 'var(--fw-bold) var(--fs-h1)/1.25 var(--font-display)', letterSpacing: 'var(--ls-heading)',
            fontVariationSettings: '"wdth" var(--display-wdth)', color: 'var(--text-primary)',
          }}>
            An agent proves it is paying <span style={{ color: 'var(--state-public)' }}>at least the asking price</span> — without revealing <span style={{ color: 'var(--state-private)' }}>how much</span>, or <span style={{ color: 'var(--state-private)' }}>who it is</span>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-7)', marginTop: 'var(--space-10)' }}>
            <div style={{ paddingTop: 'var(--space-5)', borderTop: '2px solid var(--blue-800)' }}>
              <Badge tone="neutral">Problem</Badge>
              <h3 style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>Public chains leak strategy</h3>
              <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>x402 payments show who paid, whom, how much, how often.</p>
            </div>
            <div style={{ paddingTop: 'var(--space-5)', borderTop: '2px solid var(--shield-700)' }}>
              <Badge tone="private" icon="shield-check">Mechanism</Badge>
              <h3 style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>The amount becomes a proof</h3>
              <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>A Midnight circuit proves <code style={codeMono}>coin.value &gt;= price</code> locally.</p>
            </div>
            <div style={{ paddingTop: 'var(--space-5)', borderTop: '2px solid var(--border-strong)' }}>
              <Badge tone="neutral">Result</Badge>
              <h3 style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>Merchants get paid, agents stay private</h3>
              <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>Prices and volume public. Payers and amounts never.</p>
            </div>
          </div>
        </Section>

        {/* 02 — x402 vs m402 */}
        <Section id="compare">
          <SectionHead n="02" tag="x402 vs m402" title="Same protocol, different ledger" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-8) var(--space-7)' }}>
              <Badge tone="neutral">x402</Badge>
              <h3 style={{ margin: 'var(--space-6) 0 0', font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>Everything settles in public</h3>
              <ul style={{ margin: 'var(--space-5) 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <DisclosureRow icon="eye">The amount paid</DisclosureRow>
                <DisclosureRow icon="eye">The payer&rsquo;s address</DisclosureRow>
                <DisclosureRow icon="eye">Per-agent call volume</DisclosureRow>
                <DisclosureRow icon="eye">Who pays whom</DisclosureRow>
                <DisclosureRow icon="eye">Remaining balance</DisclosureRow>
              </ul>
            </div>
            <div style={{ padding: 'var(--space-8) var(--space-7)', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-subtle)' }}>
              <Badge tone="private" icon="shield-check">m402</Badge>
              <h3 style={{ margin: 'var(--space-6) 0 0', font: 'var(--fw-semibold) var(--fs-h4)/1.3 var(--font-display)', color: 'var(--text-primary)' }}>Only the fact of payment</h3>
              <ul style={{ margin: 'var(--space-5) 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <DisclosureRow icon="eye-off">Private witness</DisclosureRow>
                <DisclosureRow icon="eye-off">No payer field — a proof, not an account</DisclosureRow>
                <DisclosureRow icon="eye-off">Unlinkable</DisclosureRow>
                <DisclosureRow icon="eye-off">No graph to observe</DisclosureRow>
                <DisclosureRow icon="eye-off">Never published</DisclosureRow>
              </ul>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', marginTop: 'var(--space-7)', padding: 'var(--space-5)', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)' }}>
            <Icon name="check" size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-primary)', fontWeight: 'var(--fw-medium)' }}>Unchanged:</strong> the 402-and-retry flow, the <code style={codeMono}>X-Payment</code> header, one call, no accounts or invoices. Agents already written against x402 learn nothing new.
            </span>
          </div>
        </Section>

        {/* 03 — How it works */}
        <Section id="how">
          <SectionHead n="03" tag="how it works" title="Four steps" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-11)', alignItems: 'start' }}>
            <div>
              <FlowStep index={1} title="GET the wrapped URL" detail="Gateway answers 402 with serviceId, price, vault." privacy="public" />
              <FlowStep index={2} title="Prove pay() locally" detail="~19s. coin.value never leaves the machine." privacy="private" />
              <FlowStep index={3} title="Retry with the nullifier" detail="Gateway verifies against the indexer in ~3.4ms." privacy="public" />
              <FlowStep index={4} title="Resource returned" detail="Origin API, or an x402 service relayed on Base." last />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              <CodeBlock title="m402Vault.compact" code={'assert(coin.value >= price as Uint<128>,\n       "underpaid");'} />
              <p style={{ margin: 0, maxWidth: '62ch', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                <code style={{ ...codeMono, color: 'var(--state-public)' }}>price</code> public, <code style={{ ...codeMono, color: 'var(--state-private)' }}>coin.value</code> private. Everything follows from that line.
              </p>
              <p style={{ margin: 0, maxWidth: '62ch', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
                The agent submits its own transaction. The gateway holds no funds and signs nothing.
              </p>
            </div>
          </div>
        </Section>

        {/* 04 — On-chain */}
        <Section id="ledger">
          <SectionHead n="04" tag="on-chain" title="What the chain records" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-7)' }}>
            <div>
              <Badge tone="public" icon="eye" style={{ marginBottom: 'var(--space-5)' }}>Public</Badge>
              <div>
                <RecordRow><code style={codeMono}>servicePrice</code></RecordRow>
                <RecordRow><code style={codeMono}>serviceOwner</code></RecordRow>
                <RecordRow><code style={codeMono}>nullifiers</code> — that a payment happened, once</RecordRow>
                <RecordRow><code style={codeMono}>merchantBalance</code></RecordRow>
                <RecordRow>deposits &amp; withdrawals</RecordRow>
              </div>
            </div>
            <div>
              <Badge tone="private" icon="eye-off" style={{ marginBottom: 'var(--space-5)' }}>Private</Badge>
              <div>
                <RecordRow><code style={codeMono}>coin.value</code> — what was actually paid</RecordRow>
                <RecordRow><code style={codeMono}>coin.nonce</code></RecordRow>
                <RecordRow>the payer</RecordRow>
                <RecordRow>who pays whom, how often</RecordRow>
                <RecordRow>the balance behind a payment</RecordRow>
              </div>
            </div>
          </div>
          <p style={{ margin: 'var(--space-7) 0 0', maxWidth: '62ch', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            The nullifier commits to the payment, so one payment can be disclosed to an auditor off-chain — that amount and nothing else.
            <a href="#limitations" style={{ marginLeft: 6 }}>Known limitations, in full, below.</a>
          </p>
        </Section>

        {/* 05 — Roadmap */}
        <Section id="roadmap">
          <SectionHead n="05" tag="roadmap" title="What's deferred, and why" />
          <p style={{ margin: '0 0 var(--space-8)', maxWidth: '68ch', font: 'var(--fw-regular) var(--fs-body-sm)/1.6 var(--font-body)', color: 'var(--text-muted)' }}>
            Scope deliberately deferred, with the reasoning and what each would take.
          </p>

          <RoadmapEntry title="Amortised proof generation">
            <p style={pBody}>Every API call currently generates a fresh proof, so the agent waits ~19s. Verification is ~3.4ms — generation is the entire cost.</p>
            <p style={pBody}><Lead>Approach.</Lead> Chaumian e-cash. The agent deposits once and the vault issues fixed-denomination notes. The wallet proves notes in the background while idle, keeping a buffer of spend-ready notes. At call time it presents an already-proven note and a nullifier. Per-call latency drops to the verification cost with no loss of privacy — every call still carries a real proof.</p>
            <p style={pBody}><Lead>Cost.</Lead> Note denomination logic, buffer refill management, a larger nullifier set. One additional circuit and a wallet change.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Arbitrary-URL relaying">
            <p style={pBody}>Relayable external x402 services are currently curated: each is registered like any other service at a fixed price. Agents choose from a list.</p>
            <p style={pBody}><Lead>Approach.</Lead> Allow an agent to point the relayer at any x402 URL discovered at runtime. Requires a <code style={codeMono}>/quote</code> endpoint — the relayer probes the external service, reads the price from its 402 response, converts to NIGHT, and returns a signed quote — plus a <strong style={strongMuted}>refund circuit</strong>, since quotes can go stale and calls can fail.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Atomic payment and delivery">
            <p style={pBody}>Payment and delivery are separate steps. If an origin fails after a payment lands, the agent has spent without receiving anything. The gateway health-checks origins before returning a 402, which narrows the window but does not close it.</p>
            <p style={pBody}><Lead>Approach.</Lead> The same refund circuit that arbitrary-URL relaying needs: return the unspent amount to the payer when delivery fails. One circuit unlocks both features.</p>
          </RoadmapEntry>

          <RoadmapEntry title="A larger anonymity set">
            <p style={pBody}>Payments are unlinkable only among other payments in the pool, and the pool is small.</p>
            <p style={pBody}><Lead>Approach.</Lead> A deposit queue that batches several agents' funding into one transaction, and a wallet default that deposits well above the immediate need so deposit sizes stop correlating with spending. The Chaumian e-cash work above helps too, by decoupling the timing of proving from the timing of spending.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Protocol fees">
            <p style={pBody}>m402 currently takes <strong style={strongMuted}>no fee</strong>. Every unit deposited is redeemable or spendable at par, and merchants receive the full <code style={codeMono}>price</code>. That keeps the demo's accounting trivially auditable, and the solvency invariant is a plain equality rather than an equality minus a rake.</p>
            <p style={pBody}>The relayer path is the exception and already earns: relayed services are listed at a price covering USDC cost <strong style={strongMuted}>plus margin</strong>, so the spread exists there today.</p>
            <p style={pBody}><Lead>Approach.</Lead> Three places a fee could sit, in increasing intrusiveness:</p>
            <ol style={olBody}>
              <li><strong style={strongMuted}>A spread on <code style={codeMono}>redeem</code></strong> — cash out at 99%. One <code style={codeMono}>assert</code> and one arithmetic line, touches neither the payment path nor its proving time, and cannot be avoided by an agent that wants its NIGHT back. Cheapest to add.</li>
              <li><strong style={strongMuted}>A cut of each payment</strong> — <code style={codeMono}>merchantBalance += price - fee</code>, <code style={codeMono}>protocolBalance += fee</code>. Most legible as a business model, but it adds a public ledger write to the hottest and most proof-expensive circuit.</li>
              <li><strong style={strongMuted}>A deposit spread</strong> — mint 99 credits per 100 NIGHT. Simple, but it prices the on-ramp, which is exactly the friction a new agent feels first.</li>
            </ol>
            <p style={pBody}>Option 1 for a first cut. Whichever is chosen, the fee must be a ledger field set at deployment rather than a compile-time constant, or changing it means redeploying and migrating every registered service.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Private merchant volume">
            <p style={pBody}><code style={codeMono}>merchantBalance</code> increases by a public <code style={codeMono}>price</code>, so call volume per service is observable. Payers are not.</p>
            <p style={pBody}><Lead>Approach.</Lead> Store merchant balances as commitments and settle with a proof at withdrawal rather than incrementing a public integer.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Stablecoin settlement">
            <p style={pBody}>Settlement is a vault-minted shielded credit backed by pooled NIGHT. Prices are entered in USD and converted once at registration using a fixed rate, so the displayed USD value drifts.</p>
            <p style={pBody}><Lead>Approach.</Lead> Settle in a Midnight-native USD stablecoin — <a href="https://midnight.network/ecosystem-catalog" target="_blank" rel="noopener noreferrer">ShieldUSD</a> is being built for exactly this class of use case, with confidentiality and selective disclosure as design goals. Prices and settlement would both be USD-denominated, removing conversion entirely.</p>
            <p style={pBody}>A contract-minted credit token is what the vault already uses, because NIGHT is unshielded and cannot be the private payment asset. A stablecoin would replace it, removing the deposit step and the USD conversion together.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Live price feed">
            <p style={pBody}>USD → NIGHT conversion uses a fixed rate applied at registration.</p>
            <p style={pBody}><Lead>Approach.</Lead> An oracle consulted at payment time, or stablecoin settlement (above), which removes the conversion. An oracle on the payment path adds staleness handling and a failure mode to the most critical flow.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Merchant onboarding without Lace">
            <p style={pBody}>Merchants must connect Lace to register. This keeps the gateway a pure read-and-proxy service with no wallet and no DUST of its own, and merchants need a Midnight wallet regardless in order to withdraw.</p>
            <p style={pBody}><Lead>Approach.</Lead> A gateway-sponsored registration path where the gateway pays DUST and the merchant address remains the owner. Still non-custodial — withdrawal always requires proving ownership.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Middleware instead of a proxy">
            <p style={pBody}>Merchants currently register a URL and traffic is proxied. This requires no code changes on their side and works with any language or stack.</p>
            <p style={pBody}><Lead>Approach.</Lead> Ship an Express/Hono middleware so merchants can run the 402 handshake themselves and keep the gateway out of their data path.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Trustless EVM settlement">
            <p style={pBody}>The relayer holds USDC and fronts payments to external x402 services, reimbursed from the vault. It is a trusted operator.</p>
            <p style={pBody}><Lead>Approach.</Lead> Verify a Midnight proof on the EVM side so no operator can withhold the float or censor a request. Verifying Halo2 proofs on EVM is a research problem; Midnight's own roadmap places a trustless ZK bridge well beyond mainnet.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Aggregate disclosure">
            <p style={pBody}>Disclosure is per-payment: the payer reveals one payment's opening to an auditor, who checks it against the on-chain commitment.</p>
            <p style={pBody}><Lead>Approach.</Lead> Prove aggregate properties over many hidden payments without revealing any of them — &ldquo;every fee paid this period was at the correct rate&rdquo;, &ldquo;total spend with this merchant is under a threshold&rdquo;. Requires bounded loops over a fixed-size array in Compact.</p>
          </RoadmapEntry>

          <RoadmapEntry title="Decentralised gateways and batching" last>
            <p style={pBody}>The gateway is a single operator and settles one payment per call. Running multiple competing gateways, and batching high-frequency micropayments, are both inherited from x402's own roadmap.</p>
          </RoadmapEntry>
        </Section>

        {/* 06 — Known limitations */}
        <Section id="limitations">
          <SectionHead n="06" tag="known limitations" title="Current, deliberate, and documented" />
          <div style={{ maxWidth: '72ch' }}>
            <LimitationEntry icon="activity">
              <strong style={strongSecondary}>Merchant call volume is public.</strong> Payers are not.
            </LimitationEntry>
            <LimitationEntry icon="eye">
              <strong style={strongSecondary}>The amount paid is public</strong>, because it equals the published <code style={codeMono}>price</code>. m402 hides who paid, not how much. A shielded amount cannot be returned as change — see{' '}
              <a href={REPO_URL + '/blob/main/docs/constraints.md#a-shielded-amount-cannot-be-returned-as-change'} target="_blank" rel="noopener noreferrer">constraints</a>.
            </LimitationEntry>
            <LimitationEntry icon="layers">
              <strong style={strongSecondary}>Concurrent throughput is unmeasured.</strong> A security review argued that writes to a contract conflict contract-wide rather than per key, which would cap a vault at about one transaction per block. Three attempts to measure it have all failed <em>locally</em>, before either call reached the chain, and every failure mode looks exactly like on-chain contention:
              <ol style={olMuted}>
                <li>Both callers shared one LevelDB private-state store. LevelDB is single-writer.</li>
                <li>Fresh stores, but a fresh store is empty — &ldquo;No private state found&rdquo;.</li>
                <li>Seeded stores, but a store scopes its keys by contract address — &ldquo;Contract address not set&rdquo;.</li>
              </ol>
              <p style={pNested}>The attempt-3 fix is in <code style={codeMono}>deploy.test.ts</code> and has not yet had a green run. Treat the ceiling as unknown until the test reports <strong style={strongSecondary}>2 of 2 landed</strong>. A 0 or a 1 is ambiguous, not a measurement: both callers share one wallet, so the bottleneck could be wallet coin selection rather than the contract. Separating them needs a second funded Preview wallet.</p>
              <p style={pNested}><code style={codeMono}>pay</code> also does a read-modify-write on <code style={codeMono}>merchantBalance[owner]</code>, which conflicts per merchant regardless of how coarse the platform's detection turns out to be. <code style={codeMono}>Map&lt;Bytes&lt;32&gt;, Counter&gt;</code> would remove that, and batching — already on this roadmap and inherited from x402's own — is the general fix.</p>
            </LimitationEntry>
            <LimitationEntry icon="link">
              <strong style={strongSecondary}>A DUST spend may be linkable to the address that registered the NIGHT.</strong> DUST is shielded, but it is generated by registered NIGHT tied to a public address. We have not established whether a spend can be traced back to that address. If it can, <code style={codeMono}>pay</code> is not anonymous regardless of what the contract does. The privacy claim should be read as unproven on this point until someone settles it.
            </LimitationEntry>
            <LimitationEntry icon="eye">
              <strong style={strongSecondary}>Deposit and redemption amounts reveal total spend.</strong> An observer sees address A deposit D and later redeem R, so A spent D−R. Every <code style={codeMono}>servicePrice</code> is public, so with few services the set of payments summing to D−R is often unique — recovering which services A bought from public data alone. Mitigations are agent-side: deposit round amounts unrelated to any price, deposit well before paying, do not redeem the exact remainder, and never redeem to the deposit address.
            </LimitationEntry>
            <LimitationEntry icon="triangle-alert">
              <strong style={strongSecondary}>Payment and delivery are not atomic.</strong> No refund path exists yet.
            </LimitationEntry>
            <LimitationEntry icon="globe">
              <strong style={strongSecondary}>The relayer is a trusted operator</strong> for its USDC float.
            </LimitationEntry>
            <LimitationEntry icon="key-round">
              <strong style={strongSecondary}>Withdrawal can be triggered by anyone.</strong> The payout destination is read from the ledger, so this cannot steal — the funds always reach the registered merchant's Lace address. Closing it would mean caller authentication, which on Midnight costs the merchant a secret to safeguard; not worth the trade.
            </LimitationEntry>
            <LimitationEntry icon="eye">
              <strong style={strongSecondary}>Deposits and withdrawals are public</strong>, in amount and in address. Only the payments between them are private. This is inherent to backing a shielded credit with an unshielded reserve, and is the same trade a shielded pool makes everywhere.
            </LimitationEntry>
            <LimitationEntry icon="shield">
              <strong style={strongSecondary}>Privacy is bounded by the anonymity set.</strong> An individual payment is unlinkable only among the other payments drawn from the pool. With one depositor and a handful of calls, an observer correlates a public deposit with the receipts that follow it, by amount and by timing — separate transactions are not enough on their own. This is a property of usage rather than of the contract, and it is the same caveat every shielded pool carries.
              <p style={pNested}>Three things raise it, none of which need code: deposit <strong style={strongSecondary}>round amounts</strong> well above any single price, deposit <strong style={strongSecondary}>ahead of time</strong> rather than immediately before spending, and have <strong style={strongSecondary}>more than one agent</strong> funding the pool. Deposit and payment must never share a transaction — that would bind amount, payer and nullifier into one public record and make the proof pointless.</p>
            </LimitationEntry>
            <LimitationEntry icon="radio">
              <strong style={strongSecondary}>Network metadata is out of scope.</strong> The gateway observes IP addresses and timing. m402 addresses protocol-level privacy: agents authenticate with a proof rather than an account, so the gateway never learns who is paying or how much.
            </LimitationEntry>
            <LimitationEntry icon="server">
              <strong style={strongSecondary}>Relayable services are curated</strong>, not arbitrary.
            </LimitationEntry>
            <LimitationEntry icon="lock">
              <strong style={strongSecondary}>Losing a receipt secret loses the purchase.</strong> Only <code style={codeMono}>hash(secret, serviceId)</code> reaches the chain, so the secret is the only proof a payment happened. It is written to the agent's private state, which is an unreplicated local LevelDB store with a hardcoded development password. Delete the store and the paid-for call cannot be claimed. Accepted for the hackathon; a real deployment needs the secret persisted before the transaction is submitted, not after, and backed up.
            </LimitationEntry>
            <LimitationEntry icon="circle-alert" last>
              <strong style={strongSecondary}>The payer-anonymity claim has a test, and that test has not yet passed.</strong> &ldquo;puts no payer identity into a pay transaction&rdquo; in <code style={codeMono}>deploy.test.ts</code> asserts that a <code style={codeMono}>pay</code> transaction carries no unshielded offer and no DUST registration — either would bind the agent's public NIGHT address to the payment. Its first run failed on harness plumbing rather than on the assertion, so the claim is currently reasoned, not demonstrated.
            </LimitationEntry>
          </div>
        </Section>

        {/* CTA */}
        <Section>
          <Card padding="lg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, maxWidth: '24ch', font: 'var(--fw-bold) var(--fs-h2)/var(--lh-heading) var(--font-display)', letterSpacing: 'var(--ls-heading)', fontVariationSettings: '"wdth" var(--display-wdth)', color: 'var(--text-primary)' }}>
                Register an API, or pay for one privately
              </h2>
              <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/var(--lh-body) var(--font-body)', color: 'var(--text-muted)' }}>
                Node 22 · Docker proof server · Lace · tNIGHT from the Preview faucet
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => navigate('/publish')}>
                Publish a service
              </Button>
              <Button variant="ghost" size="lg" onClick={() => openRepo('/blob/main/docs/design.md')}>
                Read the docs
              </Button>
            </div>
          </Card>
        </Section>

        {/* Footer */}
        <footer style={{ padding: 'var(--space-10) 0 var(--space-11)', borderTop: '1px solid var(--border-subtle)' }}>
          <Container style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-9)', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: '34ch' }}>
              <span style={{ font: 'var(--fw-bold) 18px/1 var(--font-mono)', letterSpacing: '-0.04em', color: 'var(--text-primary)' }}>
                m<span style={{ color: 'var(--accent)' }}>402</span>
              </span>
              <p style={{ margin: 'var(--space-4) 0 0', font: 'var(--fw-regular) var(--fs-body-sm)/var(--lh-body) var(--font-body)', color: 'var(--text-muted)' }}>
                Private agentic payments on Midnight.
              </p>
              <span style={{ display: 'block', margin: 'var(--space-5) 0 0', font: 'var(--fw-bold) var(--fs-micro)/1.6 var(--font-mono)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
                hack_buenos_aires · 07—08 ago 2026 · palermo_ar
              </span>
            </div>
            <FooterColumn title="Product" links={[
              { label: 'Marketplace', href: '#/explorer' },
              { label: 'Publish a service', href: '#/publish' },
              { label: 'Withdraw', href: '#/withdraw' },
              { label: 'Agent CLI', href: REPO_URL + '/tree/main/agent', external: true },
            ]} />
            <FooterColumn title="Docs" links={[{ label: 'Design', href: REPO_URL + '/blob/main/docs/design.md', external: true }, { label: 'Roadmap', href: '#roadmap' }, { label: 'Known limitations', href: '#limitations' }]} />
            <FooterColumn title="Built on" links={[{ label: 'Midnight', href: 'https://midnight.network/', external: true }, { label: 'x402', href: 'https://x402.org/', external: true }, { label: 'GitHub', href: REPO_URL, external: true }]} />
          </Container>
        </footer>
      </div>
    </div>
  );
}

export function App() {
  const [route, navigate] = useRoute();

  if (route.name === 'home') return <HomeScreen navigate={navigate} />;

  return (
    <MarketplaceShell route={route} navigate={navigate}>
      {route.name === 'explorer' && (
        <ExplorerScreen onOpenService={(slug) => navigate('/service/' + slug)} onPublish={() => navigate('/publish')} />
      )}
      {route.name === 'service' && <ServiceScreen slug={route.slug} onBack={() => navigate('/explorer')} />}
      {route.name === 'publish' && <PublishScreen onDone={() => navigate('/explorer')} />}
      {route.name === 'withdraw' && <WithdrawScreen />}
    </MarketplaceShell>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ label: string; href: string; external?: boolean }> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ marginBottom: 'var(--space-3)', font: 'var(--fw-bold) var(--fs-micro)/1 var(--font-mono)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{title}</span>
      {links.map((l) => (
        <a
          key={l.label} href={l.href}
          target={l.external ? '_blank' : undefined} rel={l.external ? 'noopener noreferrer' : undefined}
          style={{ font: 'var(--fw-regular) var(--fs-body-sm)/1.9 var(--font-body)', width: 'max-content' }}
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
