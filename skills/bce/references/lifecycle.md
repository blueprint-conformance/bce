# BCE contract lifecycle reference

Read this only for contract creation, adoption, governance, or proof work. For an ordinary RED →
code fix → GREEN task, the primary `SKILL.md` is sufficient.

## Install and discriminate

Use an exact provenance-backed version, never a range or `latest` for a merge gate:

```bash
npm install --save-dev --save-exact bce-engine@0.1.5
npx --no-install bce demo
```

The demo must produce GREEN and RED. A gate no one has seen fail is not evidence.

## Author

Derive the contract from the real tree. Never hand-write blueprint JSON: `author` owns schema,
canonical serialization, and the non-empty scope check.

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
`next-route-handler`, `plugin-surface`, and `python-import-surface`. `plugin-surface` requires
explicit scope paths.

Validate the draft:

```bash
bce validate --blueprint parameterized-queries-only.blueprint.json
```

## Onboard without approving

```bash
bce onboard \
  --repo . \
  --blueprint parameterized-queries-only.blueprint.json \
  --engine bce-engine@0.1.5 \
  --harness codex
```

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
policy changes. Keep them separate from code repairs and require human-owner review.

## CI invariants

- Pin an exact npm version or immutable 40-character Action commit.
- Do not put a workflow-level path filter on a required check; let BCE self-scope.
- Run on pull requests and merge queues where required.
- Treat exit `1` and `2` as RED.
- Keep policy operations absent from MCP.
- Never claim creator-operated or model-operated evidence is independent confirmation.
