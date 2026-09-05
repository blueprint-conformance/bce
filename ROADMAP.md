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
  What is and is not detected is stated in `coverage.unsupported` and pinned by honesty tests;
  the structured-parse deepening stays [DESIGN] below.

- **[RUNS]** Deterministic conformance grading over an authored `EngineeringBlueprint` —
  schema → extraction → evaluate → score → verdict, with fail-closed exit semantics
  (`bce gate`; [`docs/exit-codes.md`](docs/exit-codes.md)).
- **[RUNS]** TypeScript/JavaScript extraction behind one `RepositoryFacts` seam — ts-morph AST
  primary, line-scan fallback ([`src/extractors.ts`](src/extractors.ts)). The blueprint graph
  model itself is language-neutral.
- **[RUNS]** CLI verbs: `validate`, `init`/`author`, `scan`, `run`, `gate`, `teeth`, `baseline`,
  `graduate`, `portfolio`.
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

### Measurement

- **[RUNS]** Seeded-defect corpus: 34 planted architecture defects with a measured-recall gate in
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
  ([`.github/workflows/release.yml`](.github/workflows/release.yml)). `bce-engine@0.2.0` is public
  with npm provenance. Its canonical GitHub Release is immutable; the exact signed evidence assets
  are preserved in the linked supplemental immutable release after the first asset-ordering incident
  ([verification record](docs/release-v0.2.0.md)).

## Designed, not built — [DESIGN]

- **[DESIGN]** Python structured (AST) extraction. The shipped Python provider (below, [RUNS])
  is deliberately line-scan: full-fidelity structured parsing — decorators, dynamic imports,
  egress observation — is designed-for through the same provider seam but not built. See
  [docs/extending-extractors.md](docs/extending-extractors.md).
- **[DESIGN]** Research paper and archived artifacts. No paper, arXiv identifier, or artifact DOI
  exists today. [CITATION.cff](CITATION.cff) intentionally contains software metadata only, and
  [`scripts/check-release-citation.mjs`](scripts/check-release-citation.mjs) prevents provisional
  identifiers from entering a release.
- **[DESIGN]** Spec-change process beyond `v1alpha1`. The RFC process is written
  ([`rfcs/RFC-0001-process.md`](rfcs/RFC-0001-process.md)); no spec-change RFC has yet been run
  through it.

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
