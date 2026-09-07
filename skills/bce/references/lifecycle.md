# BCE contract lifecycle reference

Read this only for contract creation, adoption, governance, or proof work. For an ordinary RED →
code fix → GREEN task, the primary `SKILL.md` is sufficient.

## Install and discriminate

Use an exact provenance-backed version, never a range or `latest` for a merge gate:

```bash
npm view bce-engine@0.3.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.3.0
npx --no-install bce demo
```

The demo must produce GREEN and RED. A gate no one has seen fail is not evidence.

That immutable release includes both TypeScript/JavaScript and Python direct-module graphs.

## Optional provider-backed proposal

Use this route when the user wants BCE to call a separately configured provider. Start from a committed repository state and
an authoritative intent file:

```bash
bce propose \
  --repo . \
  --intent-file docs/architecture-intent.md \
  --assistant openai-responses \
  --assistant-model '<exact provider model id>' \
  --new
```

Use `--base <path>` instead of `--new` for an existing policy. Inspect the disclosure preview before
the network call. Treat the model plan as untrusted: only the deterministic review packet is a
reviewable artifact, and it is still draft-only. Read `docs/ai-first-review.md` for the GitHub-bound
decision and ratify/amend ceremony.

## Draft with the current coding agent

For ordinary first adoption, derive one supported boundary from the user's intent and real tree
using the current agent's reasoning. No additional model account is required. Use `author` rather
than hand-writing blueprint JSON: it owns schema, canonical
serialization, and the non-empty scope check.

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

Constraint grammar is `<type>:<argument>[:<severity>]`; severity is `info`, `low`, `medium`, `high`,
or `critical`.

| Type | Meaning |
|---|---|
| `forbiddenDependency` | a surface must not import a module |
| `requiredDependency` | a component must carry a required edge |
| `requiredComponent` | an architectural component must exist |
| `forbiddenPath` | an extracted component must not match a path glob |
| `forbiddenFile` | a raw scanned file must not exist |
| `forbiddenPattern` | a source line must not match a safe regex |
| `forbiddenEgress` | network destinations are blocked or allowlisted |
| `behavioralInvariant` | runtime evidence must satisfy a behavior reference |

`requiredEvidence`, `minimumMetric`, and `customPolicy` are reserved/run-only in v0.1; do not use
one as the enforcing constraint in a first blueprint. Extraction profiles are
`next-route-handler`, `plugin-surface`, `python-import-surface`, `typescript-module-graph`, and
`python-module-graph` in the released `v0.3.0` binary. The direct-module profiles require explicit
scope paths, use `module:`, `package:`, or `builtin:` dependency targets, and automatically write
`minEngineVersion: "0.3.0"`. Follow `docs/typescript-module-graph.md` or
`docs/python-module-graph.md`. The normal primary skill loop remains unchanged: after setup,
`doctor_repository {}` diagnoses readiness and zero-argument MCP `run_gate {}` grades the live
module graph through the same engine as the CLI.

Validate the draft:

```bash
bce validate --blueprint parameterized-queries-only.blueprint.json
```

## Onboard without approving

```bash
bce onboard \
  --repo . \
  --blueprint parameterized-queries-only.blueprint.json \
  --engine bce-engine@0.3.0 \
  --harness codex
```

This exact onboarding command supports the framework, import-surface, and direct-module profiles in
`v0.3.0`.

Harnesses are `agents`, `claude`, `cursor`, and `codex`. Onboarding installs project skills, agent
context, project-local MCP configuration, immutable CI, advisory mode, and an adoption manifest. It
does not ratify the draft. Existing context and unrelated MCP servers/settings must survive.

## Prove the contract

Working-tree run:

```bash
bce run --blueprint <path> --ct-repo . --no-pin --extractor ast --out compliance-report.json
```

Non-vacuity assessment:

```bash
bce teeth --blueprint <path> --ct-repo . --no-pin --extractor ast
```

`toothed` means extractor-real evidence can refute at least one constraint. `evaluator-refutable`
is synthetic evaluator evidence only. `toothless` exits `2`. The substance proof is a real planted
defect: clean GREEN → planted RED with the promised anchor → corrected GREEN.

Whole-repository done-check:

```bash
bce gate --repo . --extractor ast --all
```

`gate` scans live files. `run` pins committed `HEAD` unless `--no-pin` is explicit. Never confuse a
pinned GREEN with proof of an uncommitted correction.

## Brownfield adoption

1. **Advisory:** reports the full real verdict but does not block. Exit `0` can still contain RED.
2. **Baseline:** records existing violations. It may only shrink; new violations block.
3. **Graduate:** turns enforcement on. Downgrading requires an explicit reviewed rationale.

Useful attended commands:

```bash
bce baseline --repo . --dry-run
bce graduate --repo .
bce graduate --repo . --downgrade --rationale "reviewed reason"
```

Ratification, amendments, mode changes, baseline changes, waivers, workflows, and engine pins are
policy changes. Keep them separate from code repairs. Ratify/amend require the exact review packet,
an approving decision derived from a GitHub pull-request review, current maintain/admin permission,
and live SCM re-authentication; do not supply or invent reviewer identity locally. After ratify/amend
prepares the policy commit, obtain the repository's normal fresh CODEOWNER/required review before
merge; the packet decision is not a substitute for final branch protection.

## CI invariants

- Pin an exact npm version or immutable 40-character Action commit.
- Do not put a workflow-level path filter on a required check; let BCE self-scope.
- Run on pull requests and merge queues where required.
- Treat exit `1` and `2` as RED.
- Keep policy operations absent from MCP.
- Never claim creator-operated or model-operated evidence is independent confirmation.
