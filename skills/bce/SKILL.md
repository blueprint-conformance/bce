---
name: bce
description: Turn an architectural rule into an enforced merge contract using the bce CLI — author a blueprint, validate it, run it, prove it can go red, and wire it as a gate. Use when a "we always/never do X" rule lives only in prose, a review comment, or a house-rules file; when the same drift keeps being caught by hand; when a conformance check is green and nobody can say what would make it red; or when adopting a gate on a repository that already violates its own rules.
license: Apache-2.0
---

# bce — an architectural rule, turned into an enforced merge contract

`bce` is a fail-closed architecture-conformance gate. You author an **EngineeringBlueprint** — a
durable, versioned contract for a repository — and the engine measures the code against it: a
deterministic score, a verdict, named violations with file and line, and evidence anyone can
re-derive offline.

This skill drives the whole lifecycle: **author → validate → run → teeth → gate**.

## When to fire

Reach for this when one of these is true:

- **A rule was just agreed in prose.** A design discussion, an architecture decision record, or a
  review thread settled that "the web layer never imports the database client" — and the only thing
  holding that rule up is that people remember it.
- **A "we always/never do X" has to survive the next agent.** A coding agent will happily report a
  change done when it typechecks and the tests pass, while the boundary you care about quietly
  moved. Prose in a house-rules file does not stop it; a red gate does.
- **A human keeps catching the same class of drift by hand.** Anything a reviewer says more than
  twice is a constraint that has not been written down where the machine can read it.
- **A check is green and nobody can say what would make it red.** A gate no one can turn red is
  decoration. `bce teeth` grades that directly.
- **You are turning a gate on over a repository that already drifts.** There is a graduated adoption
  path — advisory, then a shrink-only baseline, then enforced — so day one is not a wall of red.

Do **not** reach for this for lint, formatting, or type errors: those already have gates and bce is
a worse tool for them. Blueprints enforce *architecture* — what may depend on what, which surfaces
may reach the network, which file shapes may exist, which symbol is the invariant.

## The lifecycle

Install the exact provenance-backed public release in the target project:

```bash
npm install --save-dev --save-exact bce-engine@0.1.1
npx --no-install bce demo
```

Keep the dependency local and exact—never a range or `latest` for a merge gate. The package exposes
both `bce` and `bce-mcp`; `bce demo` must produce a GREEN/RED discriminating pair before you trust a
green from it. Registry signatures and npm provenance authenticate the published artifact.

### 1. AUTHOR — derive the contract from the real tree

The judgment is yours: read the repository, decide **which files the invariant must hold over**,
pick the extraction profile that matches its shape, and choose constraints that actually express the
intent. Then run the CLI with those decisions as flags.

```bash
bce author \
  --id parameterized-queries-only \
  --intent-ref policy/no-string-built-sql \
  --constraint 'forbiddenPattern:SELECT .*\$\{:critical' \
  --extraction-profile plugin-surface \
  --scope-paths "src/**/*.ts" \
  --min-files 1 \
  --repo . \
  --out parameterized-queries-only.blueprint.json
```

`--intent-ref`, `--constraint`, `--repository` and `--guard-symbol` are repeatable. `bce init` is an
alias for the same verb. The constraint grammar is `<type>:<arg>[:<severity>]`, where severity is
one of `info` `low` `medium` `high` `critical` (default `high`), and the types are:

| Constraint | Argument | Catches |
|---|---|---|
| `forbiddenDependency` | a module specifier | a surface importing something it must not |
| `requiredDependency` | a component type | a component that must carry a provides/guards edge |
| `requiredComponent` | a component type | a required piece of the architecture going missing |
| `forbiddenPath` | a glob over extracted components | a component appearing where it may not |
| `forbiddenFile` | a glob over raw scanned files | a file shape that must not exist at all |
| `forbiddenPattern` | a regex, matched per line | a literal in the source — a hardcoded host, a mock left in |
| `forbiddenEgress` | `host,host` (blocklist) or `governed=host,host` (allowlist) | a surface reaching the network off-contract |
| `behavioralInvariant` | a behaviour reference | a runtime observation, not a static shape |

`requiredEvidence`, `minimumMetric`, and `customPolicy` are reserved schema types in v0.1. They can
be authored for forward compatibility but are explicitly skipped by the grader, so do not use one
as the enforcing constraint in a first blueprint.

Three extraction profiles ship today: `next-route-handler`, `plugin-surface`, and
`python-import-surface`. `plugin-surface` requires `--scope-paths`; it has no default globs.

**Never hand-write the blueprint JSON.** The CLI is the single implementation of the schema and the
canonical serializer, it self-validates the artifact it just wrote by re-reading it, and — when
`--repo` is passed — it refuses with exit 2 if the scope matches zero files. That last check is the
one a hand-written file skips, and it is exactly the failure that produces a blueprint which gates
nothing while looking authored.

Quoting note: single-quote a constraint whose pattern contains `$`, `{`, or `` ` ``, or the shell
eats it before the engine sees it.

### 2. VALIDATE — the floor is one constraint

```bash
bce validate --blueprint parameterized-queries-only.blueprint.json
```

The schema demands at least one constraint and at least one intent reference. A blueprint that
enforces nothing is rejected by construction, and that is deliberate: if you cannot name one
enforceable constraint, the intent is not understood yet. Go back to the intent, not to the schema.

### 2b. ONBOARD — compose the repository surfaces without ratifying

For a new adoption, keep the authored file outside `.blueprints/` and let `bce onboard` install the
proposal. It creates advisory mode, immutable CI, the adoption manifest, agent context, and MCP
configuration while preserving existing context and unrelated MCP servers:

```bash
bce onboard \
  --repo . \
  --blueprint parameterized-queries-only.blueprint.json \
  --engine blueprint-conformance/bce@<reviewed-40-character-commit-sha> \
  --harness agents
```

Harnesses are `agents`, `claude`, `cursor`, and `codex`. The first three generate project MCP JSON;
Codex prints its supported `codex mcp add` command instead of mutating user-global configuration.
Onboarding never approves the draft. `ratify` remains an attended human-review ceremony.

### 3. RUN — score one blueprint against one tree

```bash
bce run \
  --blueprint .blueprints/parameterized-queries-only.blueprint.json \
  --ct-repo . \
  --extractor ast \
  --out compliance-report.json
```

Exit 0 is a pass. Exit 1 is a red, and it covers two different things: a *graded* fail (constraints
evaluated, violations found) and a *structural refusal* where the engine declined to grade at all —
a malformed blueprint, or a combination it will not pretend to handle, such as `--extractor
line-scan` with a `forbiddenEgress` constraint. Exit 2 is the fail-closed scan floor: the scan
resolved fewer files than the profile requires, so no verdict is possible. Only exit 0 is a pass;
read both 1 and 2 as red, and read the message to learn which of the three you got.

Add `--emit` to write a hash-chained evidence record and the proposed remediation work orders
alongside the report (`--emit-evidence-out`, `--emit-wo-out`, and `--prev-hash` to chain onto a
previous record).

**The single most common false green in this workflow:** by default `run` pins the tree via
`git archive`, which is working-tree-immune. A green run on the pinned tree says *nothing* about the
edit you have not committed. Proving a working-tree change means `--no-pin`:

```bash
bce run --blueprint <path> --ct-repo . --no-pin --extractor ast --out compliance-report.json
```

Committed proof stays pinned — that is what CI grades. `--ref <sha|ref>` pins an explicit revision;
absent, the default is `HEAD`.

`--extractor ast` is the faithful path. `--extractor line-scan` has no symbol table, so the engine
refuses it outright for `forbiddenEgress` and for governed-module plugin surfaces rather than
silently scanning zero edges and calling that a pass.

### 4. TEETH — demand a discriminating negative

```bash
bce teeth \
  --blueprint .blueprints/parameterized-queries-only.blueprint.json \
  --ct-repo . \
  --no-pin \
  --extractor ast
```

This is the anti-vacuity check, and it is the reason a green verdict from this engine means
anything. It mutates the observed architecture graph per constraint and asks whether the constraint
notices. Three verdicts:

- **`toothed`** (exit 0) — at least one constraint has extractor-real teeth. A realistic change
  reddens it.
- **`evaluator-refutable`** (exit 0, with a warning) — refutable in principle only, via synthetic
  evidence mutations. This is **not** evidence of real teeth, and the warning says so.
- **`toothless`** (exit 2) — nothing here can fail. A green run against this blueprint proves
  nothing.

Read the verdict as a measurement, not as a string to satisfy. `evaluator-refutable` is an honest
result that tells you the constraint is not yet biting the code; the answer is to aim the constraint
at something the extractor can actually see, not to move on because the exit code was 0. The
substance proof is a mutation corpus — seed the defect the constraint claims to catch, re-run, watch
it go red, remove the defect, watch it go green.

### 5. GATE — make it the merge contract

```bash
bce gate --repo . --extractor ast --all
```

`gate` discovers every blueprint under `.blueprints/` (override with `--blueprint-dir`) and runs the
ones whose scope intersects the change. `--changed a,b,c` scopes a run to a PR's changed files;
absent, it is a full sweep. `--all` prints every violation with observed-versus-expected, the anchor,
and both remediation paths, instead of the grouped per-constraint summary. `--repo-name <org/repo>`
stamps the report and arms an identity check. `--report-json <path>` additionally writes the
machine-parseable result — a pure output side channel, byte-identical verdict with or without it —
which is what an agent loop or a CI comment should parse rather than re-deriving the verdict from
stdout.

Exit codes are canonical: **0** green, **1** graded violation, **2** fail-closed refusal. A refusal
means BCE could not honestly grade: no blueprints, zero applicable selections, identity/scope
mismatch, malformed input, an unsupported constraint/extractor combination, or another structural
cause. It is deliberately distinct from a graded red, and it can never be baselined.

Treat 1 and 2 both as red. Never treat either as a pass.

There are no skip flags. There is no `--force`, no `--no-verify`, no `--skip`. Adoption is handled by
committed configuration that shows up in a diff, never by an invisible flag.

### Adopting on a repository that already drifts

Three rungs, each one a committed, reviewable artifact:

1. **Advisory.** Commit `.bce-mode.json` containing `{ "mode": "advisory" }`. The gate prints the
   full verdict behind an unmissable banner and stamps the report, then exits 0 regardless. You see
   the real number without blocking anyone. Advisory is an adoption posture, not a skip flag —
   nothing is suppressed, only the build consequence is.
2. **Baseline.** `bce baseline` records today's violations into `.blueprints/baseline.json` as the
   accepted pre-existing set. From then on, **new** violations block and baselined ones are shown and
   counted but do not. The file only ever shrinks: a re-write drops violations that are gone and
   refuses to add ones that are not already in it. Growing the wall means deleting the file and
   re-creating it, which is visible in a diff. Preview with `bce baseline --dry-run`.
3. **Graduate.** `bce graduate` flips advisory to enforced and records the transition in-repo. Going
   the other way is refused without `bce graduate --downgrade --rationale "<why>"`, so a quiet
   weakening cannot happen.

A baseline never suppresses a structural refusal. There is no violation identity to accept, so an
empty scan or a malformed blueprint always blocks.

### Wiring it into CI and into an agent loop

The gate is a required check: it must always **report**. Two ways that goes wrong, both of which
wedge a merge queue rather than fail it:

- **No workflow-level path filter on a required check.** A path-filtered required check never runs
  on a PR outside its filter, so the PR is blocked forever on a check that will never report. The
  gate self-scopes instead — a change touching nothing in any blueprint's scope passes trivially.
  Make sure the workflow also runs on the merge-queue event, or it wedges the same way.
- **A moving version tag on the engine.** Pin an exact version. A gate whose engine floats is
  non-deterministic: the same tree yields different verdicts on different days.

For an agent working inside a gated repository, the loop is: make the change, run `bce gate`, and on
a red read the named constraint and `file#L<line>`, fix the code, re-gate. Drop-in house-rules
snippets for common assistants ship in `integrations/`, and an MCP server (`bce-mcp`) exposes six
read-only tools: `doctor_repository`, `check_baseline`, `validate_blueprint`, `run_gate`,
`assess_teeth`, and `get_report`. Policy approval and weakening operations are deliberately absent.

## The honesty invariants

These are the ways this workflow gets faked, in the order they actually happen:

1. **Never hand-write blueprint JSON when `bce author` exists.** The CLI owns the schema, the
   canonical serialization, and the scope sanity check. A hand-written blueprint that matches zero
   files scores 100 forever.
2. **Never lower a threshold, baseline a fresh violation, or reach for a skip flag to turn a red
   green.** A gate may tighten; it must never silently relax. A measured-below-threshold result is
   an honest fail. Fix the code, or fix where the constraint is aimed — and if the contract itself
   is wrong, change it deliberately, in its own reviewed change, never as a quiet workaround
   attached to unrelated work.
3. **A teeth verdict is a measurement, not a gate-able string.** `evaluator-refutable` is not
   `toothed`. The mutation corpus is the substance; the verdict word is a summary of it.
4. **Do not claim a constraint works until you have produced the red yourself.** Seed the defect,
   watch the gate fail, remove it, watch it pass. Anything short of that is a constraint you hope
   works.
5. **A structural refusal is a red.** When the engine declines to grade — a malformed blueprint, a
   scan below the file floor, no blueprints discovered at all — that is never a pass, whatever the
   exit code turns out to be. Do not route around it by narrowing the scope until the scan
   succeeds, and do not read a non-zero code you did not expect as a tooling glitch.
6. **`--no-pin` for working-tree proof, pinned for committed proof.** Mixing these up produces a
   green that describes a tree you are not looking at.

## What you just let the AI build

If an agent ran this skill for you, here is what changed and what it means.

A file now exists under `.blueprints/` that is a **contract**, not a config: it names an
architectural rule, the files it holds over, and the severity of breaking it. From here on, a change
that violates it cannot merge — the gate refuses, names the constraint, and points at the exact
line. That is real leverage, and it is real cost: the contract is now something the team maintains
deliberately, and changing it is a reviewed act rather than an edit.

Two things are worth reading before you trust it:

- **The specification** — the artifact model, the constraint taxonomy, how the score is computed,
  the exit-code contract, and the report contract. It tells you exactly what a verdict is claiming.
  <https://github.com/blueprint-conformance/bce/blob/main/spec/SPEC.md>
- **The evidence format** — how a verdict is recorded so anyone can re-derive it offline, and what
  the hash chain does and does not prove.
  <https://github.com/blueprint-conformance/bce/blob/main/docs/evidence-format.md>

(Full URLs on purpose: once this skill is installed under `.claude/skills/bce/`, it is nowhere near
the repository, so a repo-relative path would resolve to nothing.)

The one question worth asking the agent that authored it: *show me this blueprint going red.* If it
cannot produce that on demand, the contract is decoration, whatever the score says.
