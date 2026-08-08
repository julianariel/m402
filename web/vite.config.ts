import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// The Midnight SDK targets Node by default (WASM circuit execution, Buffer-based
// serialization) — wasm()/topLevelAwait()/nodePolyfills()/commonjs() make it run
// in the browser. See web/README.md.
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'crypto', 'stream'],
      globals: { Buffer: true, process: true },
    }),
    viteCommonjs(),
  ],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    // esbuild's dependency pre-bundler (dev-server only — `vite build` uses Rollup and doesn't
    // hit this) can't statically resolve `export * from '@midnight-ntwrk/ledger-v8'` inside
    // midnight-js-protocol/dist/ledger.mjs — the WASM-backed exports aren't visible to esbuild's
    // syntactic scan. Excluding the whole scope from pre-bundling sidesteps it; these packages
    // are already ESM and don't need esbuild's CJS-interop pre-bundling anyway.
    exclude: ['@midnight-ntwrk/*'],
  },
});
