import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Proof generation dominates: a single deposit or pay is ~19s and remote
    // wallet sync can take far longer. Default timeouts are useless here.
    testTimeout: 10 * 60_000,
    hookTimeout: 70 * 60_000,
    fileParallelism: false,
    include: ['src/test/**/*.test.ts'],
  },
});
