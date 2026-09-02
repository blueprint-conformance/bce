# AGENTS.md — working in this repository

This file orients a coding agent (or a human) working **on bce itself**. If you are instead looking for
the snippet to drop into *another* repo so an agent treats bce as its done-check, that is
[`integrations/AGENTS.md.snippet`](integrations/AGENTS.md.snippet).

## What this repository is

**bce, the blueprint conformance engine** — a fail-closed architecture-conformance gate. You author an
`EngineeringBlueprint` (a durable architectural contract for a repository), and bce measures the code
against it: a deterministic conformance score, a fail-closed required-check gate, and hash-chained
evidence anyone can re-derive offline. Extraction is TypeScript/JavaScript today; the blueprint graph
model is language-neutral and the extractor seam is documented (Python is the named next community
target).

## The rules that never bend

1. **The gate is the done-check.** A change is not done until `bce gate` is green. A green typecheck or
   test run is necessary but not sufficient.
2. **On a red, fix the code — never silently edit a blueprint or the baseline.** The blueprint is the
   contract; the baseline only ever shrinks. Changing either is a deliberate, separately-reviewed act.
3. **Fail-closed, no skip flags.** There is no `--skip` / `--no-verify` / `--force`. If the engine
   cannot honestly grade, it refuses (exit 2) — treat a refusal as a red, never a pass. Adoption is
   handled by committed config (advisory mode, shrink-only baseline), never an invisible flag.
4. **Nothing internal leaks.** A dependency-free `leakage-gate` runs from commit #1 and rejects any
   internal identifier, host, or credential-shaped string. Keep it green.
5. **Describe only machinery that runs.** Every workflow, script, and path this repo's docs name must
   exist or be explicitly marked as a forward/deferred item. No fictional pipelines.

## Map of the repository

| Path | What it is |
|---|---|
| `src/` | the engine (extraction → evaluate → score → verdict); `src/extractors.ts` is the only ts-morph importer |
| `src/cli.ts` | the `bce` CLI: `validate` `init` `author` `scan` `run` `teeth` `gate` `baseline` `graduate` `portfolio` |
| `src/mcp-server.ts` | the `bce-mcp` THIN stdio server (logic-free shell over the engine API) |
| `spec/SPEC.md` | the normative specification (artifact model, taxonomy, scoring, exit codes §13, report contract §11) |
| `spec/schemas/` | published JSON Schemas — generated, never hand-edited |
| `spec/conformance-vectors/` | input→expected-verdict vectors AS DATA (no runner, no levels at v1alpha1) |
| `docs/` | quickstart, adopt-existing-repo, agent-loop, exit-codes, report-contract, self-hosting, evidence-format, faq |
| `examples/quickstart/` | the guaranteed offline RED→fix→GREEN walkthrough |
| `integrations/` | drop-in agent snippets (CLAUDE.md / AGENTS.md / .cursorrules) + MCP details |
| `skills/` | the Agent Skill — the author → validate → run → teeth → gate lifecycle as a folder-per-skill `SKILL.md`, for an agent creating a contract rather than working inside one |
| `prompts/` | the experimental blueprint-author pack + its 5-public-repo validation |
| `fixtures/` + `corpus/` | the seeded-defect corpus (recall denominator) and its machine-readable manifest |
| `.blueprints/` | this repo's OWN blueprint — bce gates itself (see `docs/self-hosting.md`) |
| `.github/workflows/` | `ci`, `leakage-gate`, `self-gate`, `docs-site-check`, and active `publish-schemas` (all fail-closed) |
| `scripts/build-docs-site.mjs` | assembles `_site/` — the schemas at their `$id` paths + the rendered docs site; dependency-free, fail-closed on IA drift and dangling links |

## Build, test, gate (Node 22 toolchain)

```sh
npm ci            # clean, lockfile-exact install
npm run build     # tsup + declaration emit → dist/
npm run typecheck # tsc --noEmit, full tree
npm test          # the full vitest suite
node dist/cli.js gate --repo . --repo-name blueprint-conformance/bce   # gate this repo
```

Before you claim a change is done, all three workflows must be green. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the DCO sign-off and agent-authored-PR conventions (gate
green + evidence ref in the PR body), and [`docs/self-hosting.md`](docs/self-hosting.md) for the
self-gate and the admin-override incident policy.

## Machine-readable index

[`llms.txt`](llms.txt) is the compact, link-first index of this repository for an agent that prefers a
flat map. It points at the same documents as the table above.
