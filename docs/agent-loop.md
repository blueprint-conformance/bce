# Running bce inside an agent loop

The reason bce exists is that a coding agent will happily report a change "done" when it typechecks and
the tests pass — while the architecture has quietly drifted. `bce gate` is the done-check that closes
that gap: a change is not finished until the gate is green, and the gate names the exact contract and
line when it is not.

The loop is the same for every harness:

```
agent makes a change
        │
        ▼
   bce gate  ────────►  GREEN (exit 0) ──►  done, honestly
        │
        ▼
   RED (exit 1): the gate names the constraint + file:line
        │
        ▼
   agent FIXES THE CODE to conform  ──►  re-gate  ──┐
        │                                            │
        └────────────────────────────────────────────┘
```

Three standing rules the agent must follow — identical across every harness, because they are what
keep the loop honest:

1. **The gate is the done-check.** A green typecheck or test run is necessary but not sufficient. The
   change is not finished until `bce gate` is green.
2. **On red, fix the code — never silently edit the blueprint.** The blueprint is the contract.
   Editing it to make a red disappear changes the contract instead of meeting it; that is a
   deliberate, separately-reviewed act, never a quiet workaround.
3. **Baseline changes require review.** `.blueprints/baseline.json` only ever shrinks; accepting a new
   violation is a human decision, never the agent's unilateral edit.

The gate is fail-closed: there are no skip flags. If it cannot honestly grade (a malformed blueprint,
a partial scan), it errors — the agent treats an error as a red, not a pass.

## Per-harness wiring

Each assistant reads its house rules from a different file. Drop-in snippets that teach exactly the
three rules above — adapted to where each assistant looks — ship in
[`integrations/`](../integrations/README.md):

| Harness | House-rules file | Snippet |
|---|---|---|
| **Claude Code** | append to the repo's `CLAUDE.md` | [`integrations/CLAUDE.md.snippet`](../integrations/CLAUDE.md.snippet) |
| **Cursor** | append to the repo's `.cursorrules` | [`integrations/.cursorrules.snippet`](../integrations/.cursorrules.snippet) |
| **Codex / any tool that reads `AGENTS.md`** | append to the repo's `AGENTS.md` | [`integrations/AGENTS.md.snippet`](../integrations/AGENTS.md.snippet) |

These are **snippets**, not whole files — paste the block into your existing house-rules file so the
agent picks it up alongside everything else the repo already tells it.

### Claude Code / Cursor / CLI harnesses

For any agent that can run shell commands, the exact published dependency puts the gate on the
project's PATH. `bce onboard` can preserve and extend the appropriate context file automatically:

```bash
npm install --save-dev --save-exact bce-engine@0.1.1
npx --no-install bce demo
```

The agent runs `bce gate` (whole-repo: `bce gate --repo . --extractor ast`) as its done-check, reads
the named `file#L<line>` on a red, fixes the code, and re-gates until green.

### Generic MCP

For an agent that speaks MCP, the `bce-mcp` stdio server exposes the same engine as the CLI as six
read-only tools:

| Tool | Does |
|---|---|
| `doctor_repository` | inventory the full installation and return typed readiness actions |
| `check_baseline` | identify new debt and shrink opportunities without changing policy |
| `validate_blueprint` | parse + schema-check a blueprint |
| `run_gate` | the done-check — grade a repo, return verdict + violations |
| `assess_teeth` | confirm a blueprint is not vacuous (a realistic change could redden it) |
| `get_report` | fetch the deterministic compliance report |

Point your agent's MCP client at the `bce-mcp` bin (it ships in the same package, `bin: bce-mcp`). The
snippets tell the agent to prefer `run_gate` as its done-check. The server is deliberately thin — it
holds no logic of its own, so there is nothing in it to diverge from the CLI. See
[`integrations/README.md`](../integrations/README.md) for the MCP details.

The MCP surface cannot approve or weaken policy. `adopt`, `ratify`, `amend`, `graduate`, and baseline
growth remain attended CLI/review acts. [`onboarding.md`](onboarding.md) shows the generated project
configs and the Codex registration command.

## Having an agent draft the first blueprint (experimental)

If the repo has no blueprint yet, an agent can propose one from the existing code. The
[`prompts/blueprint-author.md`](../prompts/blueprint-author.md) pack drives a coding agent to survey a
repo, pick one real architectural invariant, express it as a blueprint, and prove it is **valid** and
**toothed** — always ending in `bce teeth` and a human PR review. The engine never writes your contract
unattended. The pack was validated on five public repositories
([`prompts/VALIDATION.md`](../prompts/VALIDATION.md)); treat its output as a starting draft to review,
never a ratified contract.

## Recommended next step

- [`../examples/quickstart/README.md`](../examples/quickstart/README.md) — the offline RED→fix→GREEN
  the loop is built on.
- [`exit-codes.md`](exit-codes.md) — what each verdict the agent reads actually means.
