# Integrations

Everything in this directory is a **drop-in surface over the same engine** — none of it contains
conformance logic. The index:

| Integration | File(s) | What it is |
|-------------|---------|------------|
| GitHub Actions | [`../action.yml`](../action.yml) (repo root) | Composite action: runs `bce gate`, emits `::error` annotations, sticky PR comment with the machine-report JSON island |
| GitLab CI | [`gitlab-ci.yml`](./gitlab-ci.yml) | Copy-paste job snippet: MR-scoped gate run, full sweep on the default branch, report kept as an artifact. A template — GitLab pipelines are not executed by this repo's test suite |
| pre-commit hook | [`pre-commit/`](./pre-commit/) | `bce-gate.sh` gates the **staged tree** before every commit, exit-code passthrough. Executed by the test suite in both of its modes (see its README) |
| Agent instructions | `CLAUDE.md.snippet`, `AGENTS.md.snippet`, `.cursorrules.snippet` | House-rules snippets teaching an agent the three rules below |
| Agent Skill | [`../skills/README.md`](../skills/README.md) | The proposal/review and validate → run → teeth → gate lifecycle as an on-demand skill, in the folder-per-skill Agent-Skills format. The snippets below are the standing done-check for a repo that already has a blueprint; the skill is what gets the contract to exist |
| MCP server | `bce-mcp` bin (ships with the package) | Ten read-only stdio tools over the same engine API |

## Agent-instruction snippets

Drop-in snippets that teach a coding agent (or a human) the three rules of working in a repository
that has an authored blueprint. They all say the same thing, adapted to where each assistant reads
its house rules from:

| File | Assistant | Where it goes |
|------|-----------|---------------|
| [`CLAUDE.md.snippet`](./CLAUDE.md.snippet) | Claude Code | append to the repo's `CLAUDE.md` |
| [`AGENTS.md.snippet`](./AGENTS.md.snippet) | Codex / OpenAI agents, and any tool that reads `AGENTS.md` | append to the repo's `AGENTS.md` |
| [`.cursorrules.snippet`](./.cursorrules.snippet) | Cursor | append to the repo's `.cursorrules` |

These are **snippets**, not whole files — paste the block into your existing house-rules file so the
agent picks it up alongside everything else the repo already tells it.

## The three rules (identical across every snippet)

1. **Run the gate before claiming a change is done.** `bce gate` (or the `run_gate` MCP tool) is the
   done-check. A change is not finished until the gate is green — a passing typecheck or test run is
   not a substitute.
2. **Fix the code, never silently edit the blueprint.** When the gate goes red, the default is to
   change the code so it conforms. Editing the blueprint to make a red go away is changing the
   contract, not meeting it — do it only deliberately, in its own change, with review.
3. **Baseline changes require review.** The baseline (`.blueprints/baseline.json`) records
   pre-existing accepted violations and only ever shrinks. Adding to it — accepting a new violation —
   is a reviewed decision, never an agent's unilateral quiet edit.

## The MCP tools (for an agent that speaks MCP)

The `bce-mcp` stdio server exposes ten read-only tools over the same engine the CLI uses:
`doctor_repository`, `check_baseline`, `validate_blueprint`, `run_gate`, `assess_teeth`, and
`get_report`, plus `inspect_blueprint`, `explain_constraint`, `compare_blueprint_policy`, and
`verify_review_packet`. Point your agent's MCP client at the `bce-mcp` bin; the snippets tell the
agent to prefer `run_gate` as its done-check. Proposal generation, decision recording, and policy
mutation tools are deliberately absent.

`bce onboard --harness agents|claude|cursor|codex` installs both project skills and merges the stdio
command into the harness's project configuration without deleting unrelated servers/settings.
Codex uses `.agents/skills` and trusted-project `.codex/config.toml`. See the complete path in
[`docs/onboarding.md`](../docs/onboarding.md).
