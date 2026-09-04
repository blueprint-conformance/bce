# Onboard the complete BCE stack

This is the single path from “I know nothing about BCE” to a repository where the contract, local
agent loop, MCP tools, and pull-request gate agree. Every surface is a thin adapter over the same
engine; you do not need every optional adapter to trust the verdict.

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

Node 22 or newer is required. Install the exact published version as a development dependency;
both `bce` and `bce-mcp` become local project binaries:

```bash
npm install --save-dev --save-exact bce-engine@0.1.5
npx --no-install bce demo
```

`demo` must print one GREEN and one RED result. If it cannot go red, stop: you do not have a
functional engine. Never use `latest` or a range for a merge gate.

## 2. Start with an AI-first reviewed proposal

For releases that include `bce propose`, the preferred first repository action is to state intent and
let the registered assistant draft inside quarantine. BCE then validates, scopes, grades, proves
teeth, and compares the exact candidate before a human sees it:

```bash
export OPENAI_API_KEY='<credential supplied outside BCE>'
npx --no-install bce propose \
  --repo . \
  --intent-file docs/architecture-intent.md \
  --assistant openai-responses \
  --assistant-model '<exact provider model id>' \
  --new
```

The model cannot approve or install policy. Follow the [AI-first review ceremony](ai-first-review.md)
to inspect the packet and bind a decision to a real pull-request review.

### Manual draft path

`bce author` remains the deterministic, offline lower-level path. Start with one important rule over
files that already exist. This example bans direct `axios` imports from TypeScript/JavaScript source:

```bash
npx --no-install bce author \
  --id no-direct-http-client \
  --intent-ref architecture/network-boundary \
  --constraint 'forbiddenDependency:axios:critical' \
  --extraction-profile plugin-surface \
  --scope-paths 'src/**/*.js,src/**/*.jsx,src/**/*.ts,src/**/*.tsx' \
  --min-files 1 \
  --repo . \
  --out bce-draft.json
```

The command refuses a scope that matches zero files. For other repository shapes, use
[the four first-win examples](first-win.md). The draft stays outside `.blueprints/` until the
onboarding command installs it as a governed proposal.

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
  --engine blueprint-conformance/bce@3611709acf0dace4698dd1876f835a73ec44837b \
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

The generated Action uses the full commit SHA for the `v0.1.5` Action source and can build that
source locally. The repository's immutable-release setting was enabled after `v0.1.5` was published,
so the tag itself is not treated as an executable trust anchor. Pass `--engine bce-engine@0.1.5`
instead when you want the generated workflow to install the exact published package independently.

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

## 6. Review and ratify

Review the generated diff, the planted RED/GREEN proof, and `.bce-adoption.json`. The current landing
ceremony requires a deterministic packet and a GitHub review; local identity/rationale flags are not
authentication. If onboarding installed a manual draft first, use it as the explicit semantic base:

```bash
npx --no-install bce propose \
  --repo . \
  --intent-file docs/architecture-intent.md \
  --assistant openai-responses \
  --assistant-model '<exact provider model id>' \
  --base .blueprints/no-direct-http-client.blueprint.json
```

Inspect the emitted packet, obtain the bound SCM decision, then ratify the candidate in quarantine
with `--packet`, `--decision`, `--github-repo`, `--github-pull`, and `--github-review` as shown in
[the complete review guide](ai-first-review.md). Ratification re-fetches the forge review before it
replaces the existing draft. Do not automate that command through MCP. Keep advisory mode until the
team is ready to graduate.

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
| `npx` tries to download a package named `bce` | the exact Git dependency did not build/install; check Node >=22 and that `node_modules/.bin/bce` exists |
| doctor exits 1 | setup is gradeable but still needs an action; read the typed warning list |
| doctor or gate exits 2 | BCE refused to claim a grade; fix discovery, scope, parser, extractor, or engine-floor cause |
| `bce run` is green but ignores an uncommitted fix | use `--no-pin` locally; `run` is pinned by default. `bce gate` and MCP `run_gate` scan the live tree |
| MCP tools do not appear | restart the harness and verify `npx --no-install bce-mcp` exists |
| CI never reports | remove workflow-level path filters and ensure the workflow event covers pull requests |
| `evaluator-refutable` teeth | this is not extractor-real proof; seed a realistic mutation or obtain an explicit reviewed waiver |

Run `npx --no-install bce doctor --repo .` whenever the installation feels ambiguous. It is the
single read-only inventory of runtime, blueprints, scope, teeth, mode, baseline, ownership, CI,
agent context, MCP packaging, and the full gate.
