---
name: bce
description: Propose, review, diagnose, and repair architecture contracts with BCE, preferring its read-only MCP tools for inspection, exact violations, and live-tree done-checks. Use when an AI-first blueprint proposal or policy comparison is requested, a BCE gate is red, advisory output reports violations despite exit 0, architectural drift must be fixed without weakening policy, or a blueprint needs validation or teeth evidence. Do not use for ordinary lint, formatting, or type errors.
license: Apache-2.0
---

# BCE — diagnose, repair, and prove architecture conformance

BCE is a fail-closed architecture-conformance gate. A blueprint is policy; source code is the normal
repair surface. Prefer the repository's BCE MCP server for diagnosis and working-tree verification.
Use the CLI only when MCP is unavailable or the requested lifecycle operation is intentionally absent
from MCP.

## Choose the shortest workflow

- **Existing repository is red:** follow the MCP-first repair loop below. Do not load lifecycle
  authoring material.
- **Readiness or setup looks broken:** call `doctor_repository {}` before the gate.
- **A blueprint or gate may be vacuous:** call `validate_blueprint`, then `assess_teeth`.
- **The user asks to inspect or compare policy:** call `inspect_blueprint`, `explain_constraint`, or
  `compare_blueprint_policy`; replay supplied evidence with `verify_review_packet`.
- **The user asks to create or adopt a new rule:** read
  `references/lifecycle.md` before acting. Prefer the AI-first `bce propose` flow when available;
  governance changes use the CLI and require an authenticated human review.
- **The user asks to tune an Agent Skill:** use the separate `skill-tuning` skill.

## MCP-first repair loop

1. Call `run_gate {}`. The generated server starts in the repository, so omit `repoDir` unless the
   user deliberately targets another tree.
2. Read structured fields, not the process exit alone:
   - `gateFailed: true`, `outcome: "violation"`, or a report `verdict: "fail"` is RED;
   - `outcome: "refusal"` is RED and must not be routed around;
   - advisory mode may return `exitCode: 0` while the substantive verdict is still RED.
3. Use each violation's `constraintId`, `evidenceRef`, `observed`, and `expected` to identify the
   smallest source-code correction.
4. Change code, not policy. Do not edit blueprints, baselines, mode, waivers, workflows, MCP config,
   installed skills, or engine pins merely to clear a violation.
5. Call `run_gate {}` again against the live working tree. Finish only when `gateFailed` is false,
   `outcome` is `pass`, and every selected report passes.
6. Report the exact violation fixed, changed code files, final score/verdict, and whether policy
   changed. A normal repair must say policy did not change.

The MCP server exposes ten read-only tools:

| Tool | Use it for |
|---|---|
| `doctor_repository` | installation, scope, proof, policy, CI, skill, and MCP readiness |
| `run_gate` | live-tree diagnosis and the final done-check |
| `validate_blueprint` | schema and safe-pattern validation |
| `assess_teeth` | non-vacuity evidence |
| `check_baseline` | new debt and shrink opportunities without changing policy |
| `inspect_blueprint` | the canonical Promise/Lens/Proof/Limits review model |
| `explain_constraint` | one clause through the same review grammar |
| `compare_blueprint_policy` | conservative semantic direction for an exact base/candidate pair |
| `verify_review_packet` | packet and optional decision integrity replay |
| `get_report` | a deterministic report already written by the engine |

MCP cannot generate a proposal, record a decision, ratify, amend, graduate, create a baseline, or
weaken policy. That absence is a security boundary, not missing functionality.

## CLI fallback

If the project has no working BCE MCP server, use the exact local package rather than fetching a
moving version:

```bash
bce gate --repo . --extractor ast --all
```

For an uncommitted repair, `gate` already scans the live tree. If you intentionally run one
blueprint directly, add `--no-pin`; otherwise `run` grades committed `HEAD` by default:

```bash
bce run --blueprint <path> --ct-repo . --no-pin --extractor ast --out compliance-report.json
```

Exit `0` is a process pass only after reading advisory state and the report verdict. Exit `1` is a
graded violation or structural refusal; exit `2` is a fail-closed scan/refusal condition. Treat `1`
and `2` as RED.

## Policy boundary

The following are governed surfaces: `.blueprints/**`, `.bce-mode.json`, baseline and waiver files,
the BCE workflow, agent/MCP configuration, installed skills, and engine pins. Do not change one as an
incidental repair. If the contract itself is wrong, stop and propose a separate reviewed policy
change with rationale.

Never:

- lower a threshold, grow a baseline, or narrow scope just to obtain green;
- interpret advisory exit `0` as conformance when reports still fail;
- claim a constraint works without a discriminating RED;
- report `evaluator-refutable` as extractor-real teeth;
- treat a structural refusal as a pass;
- claim an agent-operated run is independent-human evidence.

## Authoring and adoption

Only load `references/lifecycle.md` when the task is to create, validate, prove, onboard, ratify, or
operate a contract. It contains the constraint grammar, extraction profiles, exact commands,
advisory/baseline/graduation path, and CI invariants.

The detailed specification and evidence semantics ship with the package under `spec/` and `docs/`.
Prefer those local, version-matched files over a moving web page.
