# Onboard the complete BCE stack

This is the agent-operated path to a first draft, a real RED/GREEN proof, and advisory repository
wiring. Your existing coding agent does the work; a human states intent and approves policy.
Ratification and enforcement are explicit later steps, not effects of installing the package.
For an already-gated repository, start with the [agent repair loop](agent-start.md).

## What each piece does

| Piece | Required? | Job |
|---|---:|---|
| CLI + blueprint | yes | author and grade the architectural contract |
| committed agent context | recommended | makes `bce gate` part of the agent's definition of done |
| CI / GitHub Action | yes for merge enforcement | grades the committed tree on every pull request |
| MCP server | optional | gives MCP-capable agents typed read-only diagnosis and gate tools |
| Agent Skill / plugin | optional | teaches an agent how to author and adopt BCE, not just run it |
| evidence bundle | optional | packages the blueprint, graph, report, hashes, and reproducibility check |

The skill supplies judgment and workflow instructions. MCP supplies tools. Agent context supplies the
standing rule. CI supplies enforcement. None of those duplicates conformance logic.

## 1. Install the exact release

If you already have an installed v0.3.1 package, use its existing local binary and continue with
the demo. The commands below install published v0.3.1. Identify the installed version and verify
the [release record](release-v0.3.1.md) before changing artifacts or choosing the ceremony in step 6.

Node 22 or newer is required. Check `node --version` first. Use the repository’s existing package
manager and workspace; preserve its lockfile. For npm, install the exact release as a development
dependency. Both `bce` and `bce-mcp` become local project binaries:

```bash
npm view bce-engine@0.3.1 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.3.1
npx --no-install bce demo
```

For pnpm, use `pnpm add -D -E bce-engine@0.3.1` and `pnpm exec bce demo`. For Yarn with a `node_modules` install, use
`yarn add --dev --exact bce-engine@0.3.1` and `yarn bce demo`. Run in the intended workspace;
do not create a second lockfile. Generated MCP launchers assume a `node_modules` install; Yarn
Plug’n’Play requires a harness-specific launcher and is not covered by this walkthrough. Substitute that local runner for `npx --no-install` below.

`demo` must print one GREEN and one RED result. If it cannot go red, stop: you do not have a
functional engine. Never use `latest` or a range for a merge gate.

## 2. Let the current agent draft one rule

Have the coding agent read your repository instructions and architectural intent, inspect the real
source tree, and choose one supported boundary. It can use its own reasoning and local tools; no
second model account or API key is required. Record the intent in a repository document before
proposing policy. `--intent-ref` should point to that actual intent, not an invented authority.
For a GitHub-bound review, configure the real Git remote before authoring, or supply
`--repository owner/repo` explicitly. A later change of repository identity requires a fresh
draft and review packet; a local-folder identity is sufficient for an offline first proof.

`bce author` deterministically compiles the agent’s draft and checks its scope. Start with one important rule over
files that already exist. This example bans direct `axios` imports from TypeScript/JavaScript source:

```bash
npx --no-install bce author \
  --id no-direct-http-client \
  --intent-ref docs/architecture-intent.md \
  --constraint 'forbiddenDependency:axios:critical' \
  --extraction-profile plugin-surface \
  --scope-paths 'src/**/*.js,src/**/*.jsx,src/**/*.ts,src/**/*.tsx' \
  --min-files 1 \
  --repo . \
  --out bce-draft.json
```

Create `docs/architecture-intent.md` with the intended network boundary first. This example assumes
real TypeScript/JavaScript files under `src/`; adapt the scope to the repository instead of creating
dummy files to make a scan pass. The command refuses a scope that matches zero files. To start from an executable architecture
boundary or adapt a different repository layout, use [the First Win recipe catalog](first-win.md).
The draft stays outside `.blueprints/` until the
onboarding command installs it as a governed proposal.

For a provider-backed draft instead, use [the optional `bce propose` adapter](ai-first-review.md).
It emits `.bce/proposals/<id>/<id>.blueprint.json` and a review packet. Pass that emitted blueprint
path to onboarding in place of `bce-draft.json`; do not assume the manual draft exists. Onboarding
changes the repository, so prepare a fresh packet after the setup commit before seeking approval.
The printed disclosure precedes the network request; it is not an interactive consent prompt.

## 3. Wire the repository

`bce onboard` creates an advisory proposal, never an approved policy. It installs the draft under
`.blueprints/`, writes the committed mode and adoption manifest, creates least-privilege CI at an
immutable Action commit, adds BCE's done-check to the selected agent context without replacing
existing instructions, installs both shipped Agent Skills, and configures MCP in the harness's
project-local format.

```bash
npx --no-install bce onboard \
  --repo . \
  --blueprint bce-draft.json \
  --engine blueprint-conformance/bce@7fc24fe24c3eb41366be990023ea37b00d2ca3b8 \
  --harness agents
```

Harness choices:

| `--harness` | Context file | Skills | MCP wiring |
|---|---|---|---|
| `agents` | `AGENTS.md` | `.agents/skills/{bce,skill-tuning}` | `.mcp.json` |
| `claude` | `CLAUDE.md` | `.claude/skills/{bce,skill-tuning}` | `.mcp.json` |
| `cursor` | `.cursorrules` | `.cursor/skills/{bce,skill-tuning}` | `.cursor/mcp.json` |
| `codex` | `AGENTS.md` | `.agents/skills/{bce,skill-tuning}` | `.codex/config.toml` |

Override paths with `--agent-file` or `--mcp-config`. Paths are confined to the repository;
existing context and unrelated MCP servers/settings are preserved. The command refuses to overwrite
existing policy files, either installed skill, or an existing MCP server named `bce`.

The generated Action uses the full commit SHA for the `v0.3.1` Action source and can build that
source locally. The canonical `v0.3.1` Release is immutable, but executable workflows still pin the
source commit rather than relying on tag semantics. Pass `--engine bce-engine@0.3.1` when you want
the generated workflow to install the exact registry package independently.

These examples select v0.3.1 for CI. Upgrading a local installation does not upgrade an existing
workflow. Verify the generated engine pin before relying on the route correction in CI; v0.3.0
CI does not include it.

## 4. Diagnose, prove RED, and go GREEN

```bash
npx --no-install bce doctor --repo .
npx --no-install bce teeth \
  --blueprint .blueprints/no-direct-http-client.blueprint.json \
  --ct-repo . --no-pin --extractor ast
npx --no-install bce gate --repo . --all
```

While the generated mode is advisory, seed the forbidden import and verify the report is RED while
the gate intentionally exits `0`; remove it and verify GREEN. Use `bce run` when you specifically
need a local mutation test whose graded violation exits `1`. `--no-pin` is for proving working-tree
edits; CI grades committed code. Exit `2` is a refusal in either posture, never a pass. After human
ratification and `bce graduate`, the same new violation makes the enforced gate exit `1`.

Brownfield repositories remain advisory while the first result is understood. If existing debt
must be accepted, use `bce baseline --check` and the reviewed baseline ceremony. See
[the adoption lifecycle](adoption-lifecycle.md).

## 5. Verify the agent surfaces

The MCP server exposes ten read-only tools:

- `doctor_repository` and `check_baseline` diagnose adoption and debt;
- `validate_blueprint`, `run_gate`, and `assess_teeth` drive the correction loop;
- `inspect_blueprint`, `explain_constraint`, and `compare_blueprint_policy` expose the canonical
  Promise/Lens/Proof/Limits and semantic-review functions;
- `verify_review_packet` replays packet and optional decision integrity without writing;
- `get_report` reads a report already produced by the engine.

It deliberately cannot adopt, ratify, amend, graduate, or grow a baseline. Those are policy acts.
On a first session, launch the harness after onboarding, ask it to list BCE tools, and call
`doctor_repository` with no arguments. If onboarding changed configuration in an already-running
session, restart that session first.

Onboarding has already installed both project skills. The repository also contains a validated
OpenAI skills-only plugin manifest at `.codex-plugin/plugin.json`, but it has not been submitted to
the universal plugin directory. Do not present it as a public install path until a listing URL and a
clean-account install are recorded. The Claude plugin marketplace is an alternative distribution
path when you want user-level installation and plugin updates:

```text
# Claude Code plugin marketplace
/plugin marketplace add blueprint-conformance/bce
/plugin install blueprint@bce
```

For a manual installation, copy the complete `node_modules/bce-engine/skills/bce` and
`node_modules/bce-engine/skills/skill-tuning` directories into the skill directory your agent
supports. Copy directories, not only `SKILL.md`, because `skill-tuning` has references.

## 6. Review policy before enforcing

Review the generated diff, planted RED/GREEN proof, and `.bce-adoption.json`. The repository is now
an advisory proposal. `doctor` may report pending ratification or evaluator-only teeth; read those
findings as remaining work, not as a failed package installation or permission to weaken the rule.

Choose the ceremony supported by the exact artifact you installed:

- **Published v0.3.1:** the [provider-backed review guide](ai-first-review.md) prepares a packet and
  authenticates a non-author GitHub reviewer with maintain/admin permission. An approving review
  by the PR author does not satisfy that released path.
- **Offline preparation in v0.3.1:** [offline review preparation and solo-steward ratification](solo-steward-ratification.md)
  use `bce review prepare` with the locally authored draft and explicit, trusted-base governance.
  This path does not need a second model call or, for the installed package, a source checkout.

Commit the intended setup and source state before preparing the packet. Changes to source, policy,
or installed configuration after preparation make its evidence stale; prepare again rather than
reusing an approval for different inputs. Agents can prepare the diff and exact review material;
the authenticated human decision remains the authority.

After ratification, use the [baseline and graduation ceremony](adopt-existing-repo.md) if needed,
and verify GitHub branch protection actually requires the gate. `bce graduate` configures local
mode; a workflow file alone does not prove merges are blocked. Do not present a one-human `0.3.0`
installation as having completed solo ratification.

## 7. Emit reproducible evidence

```bash
npx --no-install bce run \
  --blueprint .blueprints/no-direct-http-client.blueprint.json \
  --ct-repo . --no-pin --extractor ast \
  --out compliance-report.json \
  --emit-bundle bce-evidence-bundle.json
npx --no-install bce verify-bundle --bundle bce-evidence-bundle.json
```

A valid bundle proves self-contained integrity and report reproduction. It does not prove who
created the artifacts or independently witnessed the run.

## If something is red

| Symptom | Meaning / next move |
|---|---|
| `npx` tries to download a package named `bce` | the local engine dependency is missing or installation failed; check Node >=22 and that `node_modules/.bin/bce` exists |
| doctor exits 1 | setup is gradeable but still needs an action; read the typed warning list |
| doctor or gate exits 2 | BCE refused to claim a grade; fix discovery, scope, parser, extractor, or engine-floor cause |
| `bce run` is green but ignores an uncommitted fix | use `--no-pin` locally; `run` is pinned by default. `bce gate` and MCP `run_gate` scan the live tree |
| MCP tools do not appear | restart the harness; inspect its generated MCP config and verify `node_modules/bce-engine/dist/mcp-server.js` exists (running the stdio server interactively waits for input) |
| CI never reports | remove workflow-level path filters and ensure the workflow event covers pull requests |
| `evaluator-refutable` teeth | this is not extractor-real proof; seed a realistic mutation or obtain an explicit reviewed waiver |

Run `npx --no-install bce doctor --repo .` whenever the installation feels ambiguous. It is the
single read-only inventory of runtime, blueprints, scope, teeth, mode, baseline, ownership, CI,
agent context, MCP packaging, and the full gate.
