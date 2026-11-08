# Roadmap

Every line in this file carries an honesty label. A roadmap that mixes shipped machinery with
aspiration, unlabeled, misleads the reader in exactly the way this project exists to prevent —
so the labels are the contract, and a mislabeled line is a bug.

## How to read this file

| Label | Meaning |
| --- | --- |
| **[RUNS]** | Exists in this repository today and is exercised by CI — you can run it now, and a workflow goes red if it breaks. |
| **[DESIGN]** | The seam, spec section, or document exists, but the implementation does not. Do not depend on it. |
| **[FUTURE]** | A direction, not a design. Nothing exists beyond the intent stated here. |

A line moves to **[RUNS]** only when the machinery is in the tree **and** a CI leg fails when it
breaks. Lines move down the ladder loudly (a regression is a red build), never up it silently.
If a label here overstates reality, that is a bug — please open an issue.

## Shipped and CI-exercised — [RUNS]

### Engine core

- **[RUNS]** Python import-surface extraction (`python-import-surface` profile) — line-oriented
  import facts (absolute/relative/aliased/parenthesized forms, comment+string exclusion) behind
  the extractor provider registry ([`src/extractor-registry.ts`](src/extractor-registry.ts),
  [`src/python-extractor.ts`](src/python-extractor.ts)); a Python RED/GREEN discriminating pair
  runs in CI and five seeded-Python corpus defects are covered by the measured-recall leg.
  What is and is not detected is stated in `coverage.unsupported` and pinned by honesty tests.

- **[RUNS]** Structured Python direct-module extraction (`python-module-graph` profile) in the
  `v0.3.0` release — a pinned parser, explicit repository import roots, resolved
  `module:`/`package:` targets, and fail-closed dynamic-import uncertainty. Its fixture pair,
  author → RED → fix → GREEN walkthrough, packed MCP proof, and self-governance teeth run in CI.
  It does not claim call, egress, transitive, or cycle analysis
  ([`docs/python-module-graph.md`](docs/python-module-graph.md)).

- **[RUNS]** Deterministic conformance grading over an authored `EngineeringBlueprint` —
  schema → extraction → evaluate → score → verdict, with fail-closed exit semantics
  (`bce gate`; [`docs/exit-codes.md`](docs/exit-codes.md)).
- **[RUNS]** TypeScript/JavaScript extraction behind one `RepositoryFacts` seam — ts-morph AST
  primary, line-scan fallback ([`src/extractors.ts`](src/extractors.ts)). The blueprint graph
  model itself is language-neutral.
- **[RUNS]** CLI verbs: `validate`, `init`/`author`, `scan`, `run`, `gate`, `teeth`, `baseline`,
  `graduate`, `portfolio`, `demo`, `doctor`, `adopt`, `onboard`, `propose`, `review`, `ratify`,
  `amend`, `upgrade`, `verify-bundle`, `stack`, `repair`, `architecture-review`, `policy-impact`
  (`bce --help` is authoritative).
- **[RUNS]** Vacuity check — `bce teeth` refuses a blueprint that cannot fail (exit 2 on a
  `toothless` verdict). A gate that cannot go red is not a gate.
- **[RUNS]** Advisory / enforced modes with one-way, recorded graduation — advisory never changes
  the computed score or violation set, only the exit code; `bce graduate` writes an in-repo
  rationale record (`.blueprints/GRADUATION.md`) and flips the committed config; a downgrade is
  refused unless the same rationale record is written ([`src/mode.ts`](src/mode.ts),
  [`docs/adopt-existing-repo.md`](docs/adopt-existing-repo.md)).
- **[RUNS]** Shrink-only baseline for brownfield adoption — `bce baseline` lets an existing repo
  turn the gate on without a day-one wall of red, and the baseline can only shrink
  ([`docs/adopt-existing-repo.md`](docs/adopt-existing-repo.md)).
- **[RUNS]** Hash-chained evidence records with a zero-dependency offline verifier — anyone can
  re-derive a verdict without this package installed
  ([`tools/verify-chain.mjs`](tools/verify-chain.mjs), [`docs/evidence-format.md`](docs/evidence-format.md)).
- **[RUNS]** Architecture review across pinned revisions (`bce architecture-review`,
  `reviewArchitectureChange`, released in v0.6.1). It runs a frozen TypeScript module-graph comparison
  of two immutable commits and reports new, resolved and retained violations with exit 0/1/2. It never
  applies baseline filtering or approves a policy
  ([`tests/architecture-review.test.ts`](tests/architecture-review.test.ts),
  [`docs/typescript-module-graph.md`](docs/typescript-module-graph.md)).
- **[RUNS]** Policy-impact preview on frozen source (`bce policy-impact`, `reviewPolicyImpact`,
  released in v0.6.1). It runs two supplied policies against one extraction of one immutable commit
  and reports introduced, removed and retained findings. A removed finding is not a repair
  ([`tests/policy-impact.test.ts`](tests/policy-impact.test.ts)). Frozen-source reads need Git 2.32 or
  newer and refuse otherwise ([`docs/portability.md`](docs/portability.md)).
- **[RUNS]** Explicit bounded dependency paths (`forbiddenDependencyPath`, `maxHops: 2`, accepted
  [RFC-0004](rfcs/RFC-0004-bounded-dependency-path.md), released in v0.6.1, `minEngineVersion`
  `0.6.1`). An unresolved or unscanned intermediate refuses with exit 2
  ([`tests/dependency-path.test.ts`](tests/dependency-path.test.ts)). Paths of three or more edges are
  outside the bound.
- **[RUNS]** Evidence-bound repair briefs (`bce repair capture`, `bce repair brief`, released in
  v0.6.1) ([`tests/repair-brief.test.ts`](tests/repair-brief.test.ts)). Automatic repair is not
  implemented.
- **[RUNS]** Experimental typed compiler with proof replay for the `forbiddenDependency` family
  (`compileBlueprint`, `verifyCompilerProof`, exported since v0.6.1). One constraint family is
  migrated; the IRs are `experimental-1`, not a ratified policy language
  ([`tests/compiler-vertical-slice.test.ts`](tests/compiler-vertical-slice.test.ts),
  [`docs/compiler-readiness.md`](docs/compiler-readiness.md)).
- **[RUNS]** Honest adoption-attempt and repeat-use records (released in v0.6.1)
  ([`tests/adoption-attempts.test.ts`](tests/adoption-attempts.test.ts),
  [`docs/adoption-lifecycle.md`](docs/adoption-lifecycle.md)). They record attempts; they are not
  independent adoption.

### Measurement

- **[RUNS]** Seeded-defect corpus: 35 planted architecture defects with a measured-recall gate in
  CI ([`src/corpus.ts`](src/corpus.ts), [`corpus/CORPUS-MAP.md`](corpus/CORPUS-MAP.md));
  [`corpus/MANIFEST.json`](corpus/MANIFEST.json) is drift-gated by test, so the index is
  consumable as ground truth.
- **[RUNS]** Offline RED/GREEN discriminating pair in CI — one blueprint, two trees, opposite
  verdicts by real exit codes (0 / 1), asserted on every push and re-executed at every release tag
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml),
  [`.github/workflows/release.yml`](.github/workflows/release.yml)).
- **[RUNS]** Self-gate (Lane B): the engine gates its own tree on every push, under the same
  fail-closed verdict its users get ([`.github/workflows/self-gate.yml`](.github/workflows/self-gate.yml),
  [`.blueprints/engine.blueprint.json`](.blueprints/engine.blueprint.json),
  [`docs/self-hosting.md`](docs/self-hosting.md)).

### Spec pack

- **[RUNS]** [`spec/SPEC.md`](spec/SPEC.md) plus 6 JSON Schemas under the
  `blueprint-conformance/v1alpha1` namespace ([`spec/schemas/`](spec/schemas)), with conformance
  vectors ([`spec/conformance-vectors/`](spec/conformance-vectors)).
- **[RUNS]** Schema-publishing workflow ([`.github/workflows/publish-schemas.yml`](.github/workflows/publish-schemas.yml)) —
  the workflow exists and runs, and the public schema URLs resolve at their declared `$id` paths.

### Integrations and release machinery

- **[RUNS]** GitHub Action ([`action.yml`](action.yml)).
- **[RUNS]** MCP server (`bce-mcp`, [`src/mcp-server.ts`](src/mcp-server.ts)) plus agent-loop
  integration snippets ([`integrations/`](integrations), [`docs/agent-loop.md`](docs/agent-loop.md)).
- **[RUNS]** Offline quickstart walkthrough — RED → fix → GREEN on a checked-in two-tree example,
  no API keys, no network beyond one install ([`examples/quickstart/`](examples/quickstart),
  [`docs/quickstart.md`](docs/quickstart.md)).
- **[RUNS]** Tag-gated release workflow that re-executes every proof at the tag — full suite,
  deterministic Agent Skills/MCP adoption, clean-install reproducibility, corpus recall, self-gate,
  and RED/GREEN pair — and refuses to publish unless all of them are green in that run
  ([`.github/workflows/release.yml`](.github/workflows/release.yml)). `bce-engine@0.6.2` is public
  with npm provenance. Its canonical GitHub Release is immutable with the exact tarball, signed
  payload manifest, signed EvidenceRecord, and compliance report attached
  ([verification record](docs/release-v0.6.2.md)).

## Designed, not built — [DESIGN]

- **[DESIGN]** Richer Python semantic analysis beyond the structured direct-import graph:
  decorators, symbol-level calls, literal egress, transitive reachability, and cycle analysis.
  These are not implied by the released module graph.
- **[DESIGN]** Research paper and archived artifacts. No paper, arXiv identifier, or artifact DOI
  exists today. [CITATION.cff](CITATION.cff) intentionally contains software metadata only, and
  [`scripts/check-release-citation.mjs`](scripts/check-release-citation.mjs) prevents provisional
  identifiers from entering a release.
- **[DESIGN]** Public spec-change process beyond `v1alpha1`. The RFC process is written
  ([`rfcs/RFC-0001-process.md`](rfcs/RFC-0001-process.md)); RFC-0002 records local maintainer
  acceptance for declared-stack enforcement, while public RFC discussion, landing, and release
  remain separate.

- **[RUNS]** Stack plane, slice 1 — `bce stack snapshot` emits a content-addressed
  `StackManifest` of the DECLARED dependency closure (npm lockfile v3 / shrinkwrap and pnpm-lock v9
  nodes keyed by name+version+integrity — pnpm through a hand-rolled YAML-subset reader, no YAML
  dependency ([`src/stack/pnpm-lock-reader.ts`](src/stack/pnpm-lock-reader.ts)), Dockerfile/compose image refs, the declared node runtime) with a
  `stackDigest` that quarantines revision, lockfile bytes, edges and coverage
  ([`src/stack/stack-manifest.ts`](src/stack/stack-manifest.ts), [`src/stack/stack-extractor.ts`](src/stack/stack-extractor.ts),
  [`spec/SPEC.md` §16](spec/SPEC.md)). The verb, the extractor and the golden-pinned determinism
  suites ([`tests/stack-determinism.test.ts`](tests/stack-determinism.test.ts),
  [`tests/stack-pnpm.test.ts`](tests/stack-pnpm.test.ts)) run under the vitest suite, AND a
  cross-OS golden-byte-identity proof over the committed `a949557` fixture now runs on every one of
  `portability.yml`'s three OS legs ([`scripts/stack-cross-os-golden-proof.mjs`](scripts/stack-cross-os-golden-proof.mjs)),
  proving the extractor reproduces the golden manifest byte for byte on ubuntu, macOS AND Windows —
  the council's cross-OS prediction is now a measured, running fact. yarn lockfiles, pnpm lockfiles
  other than v9, image-tag resolution and automatic reconciliation are not built. The public
  0.5.0 release adds the five RFC-0002 declared-stack constraints to ordinary gate/MCP and v2
  offline replay; it does not claim automatic repair or registry resolution.
  Unreleased API note: the `STACK_REFUSAL_PNPM` export (the slice-1 "pnpm is not supported" refusal
  string, never shipped in a published version) is removed — a `pnpm-lock.yaml` is now read, and its own
  refusals are the `stackRefusalPnpm*` strings.
- **[RUNS]** Stack plane — `bce stack diff --from <A> --to <B>` classifies every move between two
  StackManifests (`added` / `removed` / `forward` / `backward` / `rewritten` / `flags-changed` /
  `spec-changed` / `unknown`), joined on `(kind, name)` and never on `name@version`, with per-name
  set matching and a strict no-dependency semver parser
  ([`src/stack/stack-diff.ts`](src/stack/stack-diff.ts), [`spec/SPEC.md` §16.2](spec/SPEC.md)).
  Image and runtime moves get rows of their own, and every hashed sub-view must be explained by its
  own rows. `unknown` fails closed (`unknown-potential-backward`, exit 2); `backward`, `rewritten`
  and a same-version install-script gain exit 2 too. [`tests/stack-diff.test.ts`](tests/stack-diff.test.ts)
  pins the measured table of a real revision pair of this repository (`47a51f4` → `a949557`, the
  vitest 4 → 5 bump: 7 forward, 1 added copy, 7 removed, top classification `removed` by the max-rank
  rule) and the same-closure-different-revision zero diff (`e0f7344` ≡ `a949557`). The dedicated
  built-dist RED/GREEN CI leg now runs on every push
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): the GREEN leg materializes real
  revisions `47a51f4` → `e0f7344` via `bce stack snapshot --ref` and asserts the exact top
  classification `removed` (not merely exit 0 — a no-op or wrong pair also exits 0 trivially), and
  the RED leg is the reverse (downgrade) direction of the SAME pair, asserting exit 2 and
  `FAILS CLOSED`. The read-only `stack_diff` MCP tool exposes the classifier over two
  already-written manifests (11th tool; [`src/mcp-server.ts`](src/mcp-server.ts)). `stack
  reconcile` and any gate wiring of the diff are not built.
- **[RUNS]** Workspace-aware stack review (`bce stack snapshot --workspace-aware`, accepted
  [RFC-0003](rfcs/RFC-0003-workspace-stack-review.md), released in v0.6.1). It writes an opt-in
  schema-2 manifest with pnpm-lock v9 importer paths and direct resolutions, so `stack diff` can tell
  an importer removal or dependency drop apart from a downgrade. A schema-1/schema-2 pair refuses, and
  selected-stack gate evidence still refuses schema 2
  ([`tests/stack-workspace.test.ts`](tests/stack-workspace.test.ts),
  [`docs/stack-plane.md`](docs/stack-plane.md)).

## Directions — [FUTURE]

- **[FUTURE]** Extractors for further languages beyond Python, through the same documented seam.
- **[FUTURE]** Richer portfolio surfaces — aggregate conformance views across many repositories,
  beyond the current `bce portfolio` collect/compile verbs.
- **[FUTURE]** Integrations beyond the GitHub Action and MCP server (other CI systems, other
  agent harnesses), driven by what adopters actually ask for.
- **[FUTURE]** A non-alpha (`v1`) spec namespace — gated as described below, never self-declared.

## The standardization gate — external adoption, never self-declared

Any standardization or specification milestone — including graduating the
`blueprint-conformance/v1alpha1` namespace toward `v1`, or describing the spec as anything more
than this project's own published contract — advances **only** when at least one **external
implementation** (an engine that does not live in this repository and is not maintained by this
project's maintainers) passes the conformance corpus
([`spec/conformance-vectors/`](spec/conformance-vectors) plus the seeded-defect corpus).

Standardization is gated on external adoption. It is never self-declared. Until an external
implementation passes, the spec is exactly what it says it is: the versioned contract of one
implementation, published so that others can build against it and check their work.

In the same spirit, this roadmap will never describe the project as "first", "the standard", or
"definitive". Claims here are limited to what the tree and its CI can demonstrate.
