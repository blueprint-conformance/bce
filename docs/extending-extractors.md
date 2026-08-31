# Extending the engine to a new language

The Python provider (`python-import-surface`) is the reference for adding a language. This
guide is the checklist it followed — grounded in the code, not aspiration. Every step names
the file that enforces it, and the last two steps are the ones that make a provider *real*:
a discriminating fixture pair and corpus defects with honesty tests.

## The seam

An extractor is one class implementing `RepositoryFactsExtractor`
([src/graph.ts](../src/graph.ts)):

```ts
interface RepositoryFactsExtractor {
  readonly kind: 'ast' | 'line-scan';
  extract(repoDir: string, revision: string): ArchitectureGraph;
}
```

It consumes a `ResolvedExtraction` config ([src/extractors.ts](../src/extractors.ts) —
`resolveExtraction` merges the blueprint's `extraction` block with its constraints so the
constraint list is the single source of truth for what to scan) and emits an
`ArchitectureGraph`: components + edges + a `coverage` envelope. Determinism is a hard
contract: no wall-clock, every array sorted before return — same tree + same blueprint ⇒
byte-identical graph (the determinism tests are the oracle).

## The checklist

1. **Profile** — add your `<lang>-…-surface` value to `ExtractionProfileSchema`
   ([src/schema.ts](../src/schema.ts)) with a doc line stating which constraint types the
   profile supports and which it refuses. Widen-only: never touch the existing values.
   Regenerate the published schemas (`npm run generate-schemas` /
   [scripts/generate-schemas.ts](../scripts/generate-schemas.ts)) — the schema-parity test
   fails otherwise.
2. **Provider** — a new `src/<lang>-extractor.ts`. Decide honestly what you can extract:
   the Python provider ships line-oriented import facts because Python imports ARE
   line-oriented; it does not pretend to an AST it doesn't have. Every fidelity limit goes
   in `coverage.unsupported`, and every documented miss gets a test asserting it is NOT
   detected (a capability note that cannot fail is a bug).
3. **Registry row** — append to `EXTRACTOR_PROVIDERS`
   ([src/extractor-registry.ts](../src/extractor-registry.ts)). A single-provider language
   registers the same provider for both kind flags and declares `kindNote`. An enum value
   without a registry row throws at dispatch — LOUD, never a silent empty scan.
4. **Refusals** — any constraint type your provider cannot observe must be REFUSED at the
   gate and CLI (see the `python-import-surface` + `forbiddenEgress` refusals in
   [src/gate.ts](../src/gate.ts) / [src/cli.ts](../src/cli.ts)), never silently scored as a
   pass on a surface that cannot see the violation.
5. **Free constraint classes** — `forbiddenFile` (over `coverage.scannedFiles`) and
   `forbiddenPattern` (over `coverage.patternScan`) need no language AST: populate both
   envelopes (the shared `scanPatterns`/`toRelSorted` helpers) and those constraints work
   immediately.
6. **Fixture pair** — a conformant and a seeded-drift tree under
   `fixtures/<lang>-surface/`, one blueprint, opposite verdicts by real exit codes through
   the BUILT CLI, wired as a CI leg ([.github/workflows/ci.yml](../.github/workflows/ci.yml)).
   A gate that cannot go red is not a gate.
7. **Corpus defects** — seed real defects into `SEEDED_CORPUS`
   ([src/corpus.ts](../src/corpus.ts)) + [corpus/MANIFEST.json](../corpus/MANIFEST.json)
   (the drift gate keeps them in sync), add the conformant tree to the clean control set,
   and let the measured-recall CI leg cover your language. The recall floor only rises.
8. **Verdict stability** — prove the registry change left the existing profiles
   byte-identical ([tests/extractor-registry.test.ts](../tests/extractor-registry.test.ts))
   and sync the self-blueprint (`.blueprints/engine.blueprint.json`) for your new source
   files — the self-gate SYNC tests will tell you exactly what is missing.

## What "done" means

A language provider is done when: the RED/GREEN pair runs in CI, its corpus defects are
caught in the measured-recall leg, its honesty tests pin the documented misses, and the
self-gate is green. Not before.
