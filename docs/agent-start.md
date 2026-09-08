# Start with your agent

BCE is a local architecture check for coding agents. A blueprint records structural rules; BCE
extracts the code it can observe and returns a verdict, exact violations, and evidence. The agent
drafts, runs, diagnoses, and repairs. A human owns the architectural intent and approves policy.

The same engine serves the CLI, read-only MCP tools, and pull-request check. The review cockpit is
a human view of its evidence, not a separate architecture engine or a prerequisite for coding.

## Choose your starting point

| Situation | First action | Done when |
|---|---|---|
| This repository already uses BCE | Load its installed BCE skill and call MCP `run_gate {}` | The live-tree structured gate passes after the code change |
| Add the first boundary | Follow [ordered onboarding](onboarding.md) using the existing agent | A draft rule has a real RED/GREEN proof and advisory CLI/MCP/CI wiring |
| Understand a blueprint | Use `inspect_blueprint` and `explain_constraint`; inspect a prepared packet with `bce review show` | Promise, observed scope, proof, and limits are clear |
| Change BCE itself | Read the repository's [AGENTS.md](../AGENTS.md) and [contribution guide](../CONTRIBUTING.md) | Focused proofs and the self-gate pass; a signed-off PR explains the change |

## New repository: use the agent you already have

Your coding agent can inspect files and use `bce author` to compile a draft. That path does not
require a second assistant, provider API key, hosted BCE account, or network access after installation.
`bce propose` is an optional provider-backed drafting adapter, with an explicit model and bounded
disclosure; see [AI proposal and review](ai-first-review.md).

1. Read the repository's instructions and architectural intent. Identify one boundary that matters.
   Separate observed code from intended policy; today's dependencies are not automatically desired.
2. Check `node --version` (22+) and the existing package manager and lockfile. If BCE is already
   installed, identify and use that local artifact. For a new registry installation, the current
   published target is exact `bce-engine@0.3.1`; the [onboarding guide](onboarding.md) supplies
   npm, pnpm, and Yarn commands.
3. Run `bce demo --list` through the installed local binary, then one matching
   `bce demo --recipe <id>`. This proves the engine; it has not installed a rule in your repository.
4. Choose a supported extraction profile and real source paths. Use `bce author --repo . ...`
   to create a draft outside `.blueprints/`. Explain unsupported analysis instead of substituting
   a weaker rule and claiming the original intent is protected.
5. Validate, inspect, and prove the draft against the real tree. In a disposable copy or isolated
   worktree, plant a realistic violation, check the named source evidence, fix the source, and
   rerun the unchanged rule. Preserve unrelated changes.
6. Use `bce onboard --harness <agents|claude|cursor|codex>` to wire advisory policy, project skills,
   MCP, and immutable CI. Review the generated diff and restart the agent session to load new tools.
7. Report what is ready and what still needs human ratification, baseline review, or branch
   protection. Advisory setup is useful first use; it is not enforced adoption.

The complete command sequence, including the exact draft filename passed to onboarding, is in
[ordered onboarding](onboarding.md). Copy whole skill directories, including `references/`.

## Existing repository: operate the repair loop

Load the project-scoped BCE skill. Prefer MCP `run_gate {}`; if unavailable, run the installed
local binary as `npx --no-install bce gate --repo . --all` in an npm project. `pnpm exec bce` or
`yarn bce` serves the same purpose in those projects. Do not fetch a package named `bce`.

Read the structured result:

- `isError: true` or `outcome: "refusal"`: diagnosis failed; resolve the cause before claiming a grade.
- `gateFailed: true`, `outcome: "violation"`, or a selected report with `verdict: "fail"`: RED.
- Advisory `exitCode: 0` can still be RED. A successful process is not sufficient evidence.
- Finish with `gateFailed: false`, `outcome: "pass"`, and passing selected reports after the fix.

Use `constraintId`, `evidenceRef`, `observed`, and `expected` to repair source code. Rerun the same
contract on live files. CLI `gate` and MCP `run_gate` include uncommitted changes; direct `run`
requires `--no-pin` for working-tree feedback.

Change governed policy only as the authorized task itself. A routine repair must not narrow scope,
weaken a blueprint, grow a baseline, change mode, or remove a required workflow to obtain green.
Agents can prepare the policy diff and review evidence; they cannot invent the human's decision.

## Inspect the contract, not just its score

MCP `inspect_blueprint` takes `blueprintPath` and returns Promise/Lens/Proof/Limits for the live
tree. `explain_constraint` adds `constraintId` for a single rule. These are also agent diagnosis
tools: inspect what BCE can observe before deciding how to fix a violation.

For a prepared review packet, `bce review show --repo . --packet <path> --format json` returns the
machine view; `--format text` and `--format html` provide human review views of the same packet.
`bce review verify` checks integrity and freshness. The HTML cockpit does not approve policy.

`assess_teeth` is a non-vacuity assessment. An `evaluator-refutable` result is not extractor-real
proof. Preserve the real planted RED and exact source anchor as evidence of what the rule detects.

## Know which artifact you are operating

The immutable `bce-engine@0.3.1` registry release includes named demos, authoring, onboarding,
ten MCP tools, provider-backed proposals, and the non-author GitHub review path. It also includes
offline `review prepare`, explicit solo-steward ratification, and coherent lifecycle audits.
Those additions are absent from v0.3.0. An installed v0.3.1 package runs them through its local
binary without a source checkout; see [solo-steward ratification](solo-steward-ratification.md).
Verify the [release record](release-v0.3.1.md) before changing the selected artifact.

Prefer the installed package's local `docs/` and skill references for version-specific behavior.
The `0.3.0` tarball omits `spec/SPEC.md`; use the [released specification](https://github.com/blueprint-conformance/bce/blob/v0.3.0/spec/SPEC.md)
when operating that version. The v0.3.1 package includes `spec/SPEC.md`; read that local,
version-matched file when it is present.

The public `llms.txt` and each documentation page's Markdown link provide browser-free reading.
These public docs describe current source and label release differences. A passing source CI run
does not update a previously published npm package.

## Report useful adoption evidence

At handoff, name the installed version or source commit, the intended boundary, scanned paths,
planted violation and source anchor, final structured verdict, installed harness, and adoption mode.
List remaining actions and unsupported scope. Do not equate first use with ratification or retention.

For a problem, [file a bug](https://github.com/blueprint-conformance/bce/issues/new?template=bug.yml)
with the command/tool call, expected behavior, actual result, and a minimal redacted reproduction.
For a full independent attempt, use the [adoption journey form](https://github.com/blueprint-conformance/bce/issues/new?template=independent-adoption.yml).
Ordinary help does not require a public evidence bundle. No telemetry or automatic submission is
required. Agent-operated first-party checks do not establish independent adoption or product efficacy.
