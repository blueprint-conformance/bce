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
npm view bce-engine@0.2.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.2.0
npx --no-install bce demo
```

The agent runs `bce gate` (whole-repo: `bce gate --repo . --extractor ast`) as its done-check, reads
the named `file#L<line>` on a red, fixes the code, and re-gates until green.

### Generic MCP

For an agent that speaks MCP, the `bce-mcp` stdio server exposes the same engine as the CLI as ten
read-only tools:

| Tool | Does |
|---|---|
| `doctor_repository` | inventory the full installation and return typed readiness actions |
| `check_baseline` | identify new debt and shrink opportunities without changing policy |
| `validate_blueprint` | parse + schema-check a blueprint |
| `run_gate` | the done-check — grade a repo, return verdict + violations |
| `assess_teeth` | confirm a blueprint is not vacuous (a realistic change could redden it) |
| `inspect_blueprint` | render the canonical Promise/Lens/Proof/Limits contract model |
| `explain_constraint` | explain one constraint through the same review grammar |
| `compare_blueprint_policy` | classify exact base/candidate policy direction conservatively |
| `verify_review_packet` | replay packet and optional decision integrity without writing |
| `get_report` | fetch the deterministic compliance report |

Point your agent's MCP client at the `bce-mcp` bin (it ships in the same package, `bin: bce-mcp`). The
snippets tell the agent to prefer `run_gate` as its done-check. The server is deliberately thin — it
holds no logic of its own, so there is nothing in it to diverge from the CLI. See
[`integrations/README.md`](../integrations/README.md) for the MCP details.

When the server is launched from the repository—as every generated project config does—
`doctor_repository`, `check_baseline`, and `run_gate` default to that working directory. The normal
agent calls are therefore `doctor_repository {}` and `run_gate {}`; pass `repoDir` only when
intentionally inspecting a different tree. MCP `run_gate` scans live files, including uncommitted
edits.

The MCP surface cannot approve or weaken policy. `adopt`, `ratify`, `amend`, `graduate`, and baseline
growth remain attended CLI/review acts. [`onboarding.md`](onboarding.md) shows the generated project
skill and MCP configurations for every harness.

## Having an agent draft the first blueprint

Use [`bce propose`](ai-first-review.md) when the installed release exposes it. The command sends only
the previewed bounded context to a registered adapter, compiles draft-only output, and emits a
deterministic review packet automatically. The older
[`prompts/blueprint-author.md`](../prompts/blueprint-author.md) pack remains a manual harness fallback;
its output is likewise only a starting draft and never a ratified contract.

## Recommended next step

- [`../examples/quickstart/README.md`](../examples/quickstart/README.md) — the offline RED→fix→GREEN
  the loop is built on.
- [`exit-codes.md`](exit-codes.md) — what each verdict the agent reads actually means.
