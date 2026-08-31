# Prompt pack — draft a blueprint from an existing repository

> **Status: experimental.** This is an agent *inference* aid, not an engine feature. It drives a
> coding agent to **propose** an `EngineeringBlueprint` for a repository it can read; a human then
> reviews and merges that proposal through a normal PR. The engine never authors your contract
> unattended, and `bce teeth` is the hard gate that refuses a vacuous draft. It has been validated
> on a set of public repositories (see [`VALIDATION.md`](VALIDATION.md)); treat its output as a
> **starting draft to review**, never as a ratified contract.
>
> If you just want to see bce work, do the [quickstart](../examples/quickstart/README.md) first —
> that is the guaranteed offline path and it does not depend on this pack.

---

## What you are asking the agent to do

Give this file to a coding agent that can read the target repository and run shell commands. The
agent surveys the repo, identifies ONE real architectural invariant the codebase already upholds
(or intends to), expresses it as a small blueprint using constraints the engine can actually
evaluate, and proves the draft is **valid** and **toothed** before handing it to you. You review
the draft as a PR — accept it, tighten it, or reject it.

The contract the agent must honor, non-negotiable:

- **Propose, never apply.** The agent writes a `*.blueprint.json` file and stops. It does not edit
  the repository's source to make a gate pass, and it does not commit the blueprint — it opens a PR
  (or leaves the file for you to open one). Fixing code and amending contracts are human-reviewed
  acts.
- **Teeth or it does not ship.** Every draft ends in `bce teeth`. If the blueprint is TOOTHLESS (no
  constraint a realistic change could redden), the agent must NOT present it as done — it revises or
  reports that no toothed invariant was found. A green gate over a toothless blueprint proves
  nothing, and the tool says so.
- **Real invariants only.** The constraint must express something true about *this* repo's
  architecture, expressed against *this* repo's real file paths. A constraint that matches no files,
  or forbids something the repo would never do, is noise — the agent must pick an invariant that is
  both real and enforceable.

---

## What the engine can enforce (read this before drafting)

Extraction is **TypeScript / JavaScript** today (ts-morph AST, with a line-scan fallback). The
blueprint graph model is language-neutral, but the shipped extractor reads `.ts`/`.js`/`.mjs`/`.cjs`
sources. Draft accordingly.

Two extraction **profiles** shape how files become a graph:

- `next-route-handler` — exported HTTP-verb handlers in Next.js `route.ts` files are components;
  bare `requireTenant*`-style guard calls in a handler body are `guards` edges. Use this only for a
  Next.js API surface.
- `plugin-surface` — a general surface: an exported factory (a `const`/`function` whose name ends
  `Extension`, or a default export) is a component; a governed registration call inside it is a
  `provides` edge; a forbidden module import anywhere in a scanned file is a forbidden `imports`
  edge. **This is the profile to reach for on an arbitrary repo** — point its `--scope-paths` at the
  real source glob you want to govern.

The **workhorse constraints** — these evaluate over the scanned files regardless of which profile is
active, so they are what you will use most on a general repo:

| Constraint | What it forbids / requires | Reddens when |
|---|---|---|
| `forbiddenDependency:<module>` | an `import`/`require` of `<module>` anywhere in scope | a scoped file imports `<module>` |
| `forbiddenFile:<glob>` | any raw file matching `<glob>` (export-shape-agnostic) | a file at that path exists |
| `forbiddenPattern:<regex>` | any line matching `<regex>` in a scoped file | a scoped line matches |
| `forbiddenEgress:<host,...>` | a `fetch`/HTTP call to a forbidden host (blocklist) | a scoped call egresses to it (**AST only**) |
| `forbiddenEgress:governed=<host,...>` | a `fetch`/HTTP call to a host NOT on the allowlist | a scoped call egresses off-allowlist (**AST only**) |
| `forbiddenPath:<glob>` | a *component* under `<glob>` | a component is extracted there |

Structural constraints (`requiredComponent:<type>`, `requiredDependency:<type>`) depend on the
profile's extractor recognizing your components — powerful for a Next.js route surface or a
recognized plugin factory, but fragile on an arbitrary repo whose shape the profile does not model.
**Prefer the workhorse `forbidden*` constraints for a first blueprint on an unfamiliar repo** — they
are the most portable and the least likely to mislabel a conformant repo.

Three constraint types (`requiredEvidence`, `minimumMetric`, `customPolicy`) are declared-but-not-yet
-enforced by the grader; `teeth` reports them INDETERMINATE, not toothed. Do not build a first
blueprint solely from those — it will be toothless.

Optional trailing severity on any constraint: `:<info|low|medium|high|critical>` (default `high`).

---

## The procedure the agent follows

### 1. Survey the repository

Read enough to name the architecture honestly:

- The real source root(s): `src/`, `lib/`, `packages/*/src/`, `app/`, … and their file extensions.
- The dependency posture: read `package.json` `dependencies`. Is it zero-dependency? Does it
  deliberately avoid a class of dependency (a server framework with no HTTP client; a pure library
  with no I/O)?
- The layering: in a monorepo, which package sits below which (a lower layer must not import a
  higher one).
- Any stated rules: `CONTRIBUTING.md`, `AGENTS.md`/`CLAUDE.md`, `.cursorrules`, architecture docs,
  ADRs.

### 2. Pick ONE real invariant

Name a rule that is **true of this repo** and that a realistic bad PR could **violate**. Good
first-blueprint shapes, in order of portability:

- **A dependency boundary** — "the core (`lib/`) must not import `<a module the project deliberately
  avoids>`." Zero-dependency libraries and framework cores are the cleanest cases: the invariant is
  real, the verdict is a clean PASS, and `teeth` confirms it could redden.
- **A layering rule** (monorepos) — "package `A` must not import package `B`" where `B` is a higher
  layer than `A`.
- **A no-mock / no-debug rule** — "no `console.log(` in the shipped library source" via
  `forbiddenPattern`.
- **A no-parallel-implementation rule** — "no second file matching `**/*-legacy.*`" via
  `forbiddenFile`.

Avoid inventing a rule the repo does not actually hold to (it will either be absurd or immediately
red for reasons nobody agreed to). One toothed constraint is a fine first blueprint — more is not
better if the extra ones are trivial.

### 3. Draft the blueprint with `bce author`

`bce author` is interactive-free and self-validating — it emits a schema-VALID draft and, with
`--repo`, refuses (exit 2) a scope that matches zero files. Name the output `*.blueprint.json` so
`bce gate` can discover it.

```bash
bce author \
  --id <kebab-id> \
  --name "<one honest sentence naming the invariant>" \
  --intent-ref "policy/<why-this-rule-exists>" \
  --constraint "forbiddenDependency:<module>:high" \
  --extraction-profile plugin-surface \
  --scope-paths "<the real source glob, e.g. lib/**/*.js>" \
  --min-files <a floor at or below the real file count> \
  --repo <path-to-target-repo> \
  --out <id>.blueprint.json
```

- `--scope-paths` is the real glob you want to govern. `--min-files` is a fail-closed floor: if a
  future scan resolves fewer files than this, the gate refuses rather than score a stale glob green.
  Set it at or just below the current file count.
- `--intent-ref` is mandatory (every blueprint traces to a stated reason) — write a real policy
  reference, not a placeholder.
- The draft is born `status: draft`. Ratifying it to `approved` is the human's PR act, not the
  agent's.

### 4. Prove it: validate, then teeth

```bash
bce validate --blueprint <id>.blueprint.json
bce teeth --blueprint <id>.blueprint.json --ct-repo <path-to-target-repo> --no-pin --extractor ast
```

- `validate` must print `blueprint VALID`.
- `teeth` must print `toothed` and exit 0. **If it prints `TOOTHLESS` (exit 2), the draft is not
  done** — the agent picks a different invariant or a constraint the extractor can actually witness,
  and repeats. Do not present a toothless blueprint as a result.

### 5. Run the gate and read the verdict

```bash
# put the blueprint where the gate discovers it, then gate the repo
mkdir -p <path-to-target-repo>/.blueprints
cp <id>.blueprint.json <path-to-target-repo>/.blueprints/
bce gate --repo <path-to-target-repo> --extractor ast --all
```

Read the verdict and make sure it is **explainable**:

- A **PASS** (score 100, exit 0) on a repo that genuinely upholds the invariant is the expected,
  honest result — the rule holds, and `teeth` already proved it *could* fail. This is a good
  blueprint.
- A **RED** (exit 1) means the repo actually violates the invariant right now. That is only correct
  if the violation is real — read the named file:line and confirm it is a true drift, not a
  mis-scoped glob or a rule the repo never agreed to. If the RED is spurious, fix the blueprint (the
  scope or the constraint), not the repo.
- An absurd verdict (a PASS on a repo that obviously violates the rule, or a RED naming something
  that is not really a violation) means the blueprint is wrong — revise it.

### 6. Hand it to a human

The agent's output is a **draft blueprint plus its evidence**: the `validate`, `teeth`, and `gate`
transcripts. Present them and stop. The human reviews the draft as a PR — accepts, tightens the
scope or severity, or rejects it. Merging the blueprint (and ratifying it to `approved`) is the
human's decision. On a real red found later, the standing rule is: **fix the code; never edit the
blueprint to make a red disappear without human review.**

---

## The instruction to paste to the agent

> You are drafting an architecture-conformance blueprint for the repository at `<PATH>`, to be
> graded by `bce` (the blueprint conformance engine; `bce --help` for the CLI). Follow the procedure
> in `prompts/blueprint-author.md` exactly:
>
> 1. Survey the repo (source roots, `package.json` dependencies, layering, any stated architecture
>    rules).
> 2. Choose ONE real architectural invariant this repo upholds that a bad PR could violate — prefer
>    a dependency-boundary or layering rule expressed with a `forbidden*` constraint over the
>    `plugin-surface` profile.
> 3. Draft it with `bce author`, pointing `--scope-paths` at the repo's real source glob and setting
>    `--min-files` at or below the current file count.
> 4. Prove it with `bce validate` and `bce teeth --no-pin --extractor ast`. If `teeth` reports
>    TOOTHLESS, pick a different invariant and repeat — never present a toothless blueprint.
> 5. Run `bce gate --repo <PATH> --extractor ast --all` and confirm the verdict is explainable (a
>    PASS on a repo that genuinely upholds the rule is correct; a RED must name a real violation).
> 6. STOP and present the draft blueprint plus the validate/teeth/gate transcripts for human review.
>    Do NOT edit the repository's source to make the gate pass, and do NOT commit the blueprint —
>    leave it for a human to review and merge as a PR.

---

## When this pack does not fit

If the target is not TypeScript/JavaScript, the shipped extractor cannot read it — the graph model
is language-neutral but the extractor is not yet. Draft against the TS/JS surface of a mixed repo,
or wait for the community extractor seam (Python is the named next target). If the agent cannot find
a single toothed invariant it can express, that is a real finding: say so rather than ship a
toothless blueprint. The [quickstart](../examples/quickstart/README.md) remains the guaranteed path
regardless.

---

## Recommended next step

- Run the [quickstart](../examples/quickstart/README.md) if you have not — it is the offline,
  zero-key RED→fix→GREEN that this pack builds on.
- Read [`VALIDATION.md`](VALIDATION.md) for the public-repo runs that gate this pack's acceptance.
- Learn the adoption levers (advisory mode, shrink-only baselines) in [`../docs/faq.md`](../docs/faq.md).
