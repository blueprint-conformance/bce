# Seeded-defect taxonomy — coverage audit (corpus v3)

The corpus is graded on three axes: **constraint type** (what policy class the defect
violates), **drift mechanism** (the syntactic route the drift takes), and **surface** (which
extraction profile observes it). This file is the audit that drove the v3 expansion
(28 → 34): every cell either cites the defect ids covering it, or states honestly why it is
uncovered — `[EXPRESSIBLE]` (the engine can catch it today; seeding is corpus work) or
`[DESIGN]` (catching it needs new engine capability; seeding it today would produce a
silently-missed corpus row, which the recall gate forbids).

## Coverage matrix (34 defects)

| Constraint type | Surface | Mechanisms covered (defect ids) |
| --- | --- | --- |
| forbiddenDependency | plugin-surface (TS) | static import (`ext-direct-openai-import`), re-export (`ext-reexport-openai`), dynamic import (`ext-dynamic-import-openai`), dynamic template (`ext-dynamic-template-openai`), require (`ext-require-openai`), require template (`ext-require-template-openai`), import-equals (`ext-import-equals-openai`, v3), subpath prefix (`ext-subpath-openai-import`, v3), unrecognized-factory attribution (`ext-unrecognizable-forbidden-import`) |
| forbiddenDependency | python-import-surface | plain import (`py-direct-openai-import`), aliased (`py-aliased-openai-import`, v3), parenthesized from-import (`py-paren-from-import`, v3) |
| requiredDependency (governed registration) | plugin-surface | missing registration (`ext-ungoverned-registration`), shadowed harness (`ext-shadowed-harness-decoy`), decoy object (`ext-decoy-registration`), stray registration outside factory (`ext-stray-register`), ungoverned-module bare call (`ext-ungoverned-registry-import`), zero-targets (`ext-unrecognizable-zero-targets`) |
| requiredDependency (tenant guard, D6) | next-route-handler | missing guard (`rg-missing-tenant-guard`), unguarded new route (`rg-unguarded-new-route`), decoy guard object (`rg-decoy-guard-object`) |
| requiredComponent | plugin-surface | unrecognizable factory (`ext-unrecognizable-factory`) |
| forbiddenEgress | plugin-surface | house-idiom `\|\|`-chain default (`ext-ungoverned-egress-provider`), options-bag host (`ext-ungoverned-egress-optbag`), undici constructor (`ext-ungoverned-egress-undici-client`), `new URL()` const-hop (`ext-ungoverned-egress-new-url`, v3), `globalThis.fetch` (`ext-ungoverned-egress-globalthis`, v3) |
| forbiddenPath | next-route-handler | legacy route path (`rg-legacy-route-path`) |
| forbiddenFile | next-route-handler / python | shadow provisioner (`rg-shadow-provisioner-file`), committed secrets module (`py-committed-secrets-module`) |
| forbiddenPattern | next-route-handler / python | mocked metric (`rg-mocked-metric-pattern`), hardcoded provider key (`py-hardcoded-provider-key`) |
| behavioralInvariant | plugin-surface (served) | constant function (`bhv-constant-function`), oracle violation (`bhv-oracle-violation`) |

## Uncovered classes — honest disposition

- `[EXPRESSIBLE]` **export-star re-export** (`export * from 'openai'`) — the extractor emits it
  (export-declaration walk); near-duplicate of `ext-reexport-openai`'s mechanism. Seedable any
  time; deferred as low-marginal.
- `[EXPRESSIBLE]` **mixed-language repo** (one blueprint per language over the same tree) —
  both profiles run today; a composite fixture is corpus plumbing, not engine work. Deferred
  to the internal dogfood bundle, which exercises exactly this shape on a real tree.
- `[DESIGN]` **cross-module indirection** (forbidden import re-exported through an in-repo
  barrel, guard applied via an imported wrapper) — extractors declare `no cross-module symbol
  resolution` in `coverage.unsupported`. Needs engine capability; not seedable honestly.
- `[DESIGN]` **python dynamic imports** (`__import__`, `importlib.import_module`) — documented
  miss, pinned by honesty tests (a seeded defect here would be a permanently-red corpus row).
- `[DESIGN]` **egress via cross-module/env-only hosts** — fail-OPEN by design (advisory
  disclosure, never a false RED); the advisory path is covered by the CLEAN fixtures
  (`advisory-egress-*`), which is the honest shape for a fail-open surface.
- `[DESIGN]` **baseline-interaction drift** (a violation smuggled INTO a baseline refresh) —
  needs a baseline-aware corpus harness; the shrink-only property is unit-tested today.

## Append-only rule

The corpus only grows (the size floor is pinned in `tests/corpus.test.ts`); thresholds only
tighten. A defect the engine stops catching is an engine bug surfaced by the recall gate —
never a row to delete.
