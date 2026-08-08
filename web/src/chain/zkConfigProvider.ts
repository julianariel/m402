import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';

/**
 * Browser counterpart to NodeZkConfigProvider — fetches the same `keys/<id>.prover`,
 * `keys/<id>.verifier`, `zkir/<id>.bzkir` layout `compact compile` produces, but over HTTP
 * from static assets instead of the filesystem. `@midnight-ntwrk/midnight-js-fetch-zk-config-provider`
 * doesn't exist at the SDK version this repo is pinned to (4.1.1) — see web/README.md.
 */
export class FetchZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  constructor(
    private readonly baseUrl: string,
    // Bound to globalThis: called as `this.fetchFn(url)` below, and native fetch throws
    // "Illegal invocation" if invoked with any receiver other than window/self.
    private readonly fetchFn: typeof fetch = fetch.bind(globalThis),
  ) {
    super();
  }

  private async fetchBytes(subDir: string, circuitId: K, ext: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/managed/m402Vault/${subDir}/${circuitId}${ext}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`FetchZkConfigProvider: ${url} returned HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    return createProverKey(await this.fetchBytes('keys', circuitId, '.prover'));
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return createVerifierKey(await this.fetchBytes('keys', circuitId, '.verifier'));
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    return createZKIR(await this.fetchBytes('zkir', circuitId, '.bzkir'));
  }
}
