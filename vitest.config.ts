import { defineConfig } from 'vitest/config';

/**
 * The AST extractor path (`ts-morph` `Project` + `addSourceFileAtPath`) resolves
 * the TypeScript compiler and reads real fixture files from disk on first use.
 * That cold-start is ~250ms locally but spikes to 5-8s on the cold, I/O-slower
 * CI runner — enough to exceed vitest's 5000ms default and time out (the
 * `line-scan` siblings stay ~1ms and never hit it). This is a deterministic-but-
 * slow test, not a flaky assertion, so the fix is a longer timeout — matching the
 * house pattern for ts-morph/heavy packages (cognitive-contracts,
 * browser-automation both set 30000). No assertion is weakened.
 *
 * Raised 30000 -> 60000 (2026-07-23): the gateway-harvest-cli suite drives the REAL
 * CLI via `execFileSync('npx', ['tsx', 'src/cli.ts', ...])` — an even heavier per-test
 * cold-start than the ts-morph extractor path. On the cold CI runner (run 29999533958)
 * a SINGLE-spawn case ran ~29.3s (98% of the 30000ms ceiling — the true nearest-miss)
 * and the ONLY double-spawn case (`DETERMINISTIC`, forward+reversed fixtures) ran ~33s
 * and TIMED OUT. Tests run sequentially (per-test sum ≈ wall-clock = one blocking
 * execFileSync fork), so a WHOLE-FILE bump is the robust lever — it protects every case
 * (incl. the single-spawn nearest-miss) uniformly rather than band-aiding only the one
 * observed casualty. No assertion is weakened; the ceiling only rises.
 */
export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
