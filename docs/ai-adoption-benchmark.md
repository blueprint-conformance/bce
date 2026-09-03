# AI-agent adoption benchmark

BCE treats Agent Skills and MCP as primary product surfaces, not packaging extras. The executable
proof is:

```bash
npm run build
npm run test:ai-adoption
```

It creates four clean repositories and onboards `agents`, `claude`, `cursor`, and `codex`. For each
harness it requires both complete skills to be discoverable in project scope, requires project-local
MCP configuration, checks that existing Codex settings survive, and records onboarding wall time.
After setup it launches the real `bce-mcp` binary from the consumer repository and requires:

- all six tools, each marked read-only, non-destructive, idempotent, and closed-world;
- initialization guidance that routes all six jobs;
- `doctor_repository {}` and `run_gate {}` to work without redundant repository arguments;
- clean GREEN, a live uncommitted `axios` drift reported RED at the exact file/line, and corrected
  GREEN through the same long-lived MCP process;
- a missing-skill negative control and the planted-drift negative control to discriminate;
- each local onboarding/call observation to remain below a generous five-second hang ceiling.

The script prints a JSON result with environment, per-harness timing, MCP call timing, negative
controls, and limitations. Timings are deliberately not committed as a universal number: runner
load and hardware dominate small local measurements. CI uses them only to catch hangs or severe
regressions.

## Opt-in model-driven evaluation

The deterministic proof cannot establish that a model will actually select the skill and MCP tools.
An authenticated Codex installation can sample that behavior explicitly:

```bash
npm run build
npm run eval:ai-adoption
```

The eval packs the current candidate, installs it into a clean Git repository, authors and onboards
an advisory blueprint, plants one forbidden Axios import, and gives Codex a generic repair prompt.
It parses Codex JSONL and the final Git diff. PASS requires all of the following observable events:

- the model reads the project-scoped BCE `SKILL.md`;
- BCE MCP `run_gate` reports RED with `src/billing.extension.ts#L1`;
- only `src/billing.extension.ts` changes and no policy/configuration path changes;
- a second MCP `run_gate` reports GREEN; and
- the schema-constrained final result says pass and `policyChanged: false`.

Set `BCE_MODEL=<model>` to record an explicit model. Otherwise the result honestly says the account
default was not resolved. `BCE_KEEP_MODEL_EVAL=1` retains the scratch consumer for inspection.
The eval is opt-in rather than required CI because it consumes a model sample and depends on account
access, user configuration, cache state, and runner load.

### Observed paired sample, 2026-09-02

Under the same generic prompt and Codex CLI 0.152.1, the released 0.1.4 instruction surface loaded
the BCE skill but used the CLI for both gates. The MCP-first candidate loaded the skill, called MCP
`run_gate {}` RED, removed only the unused import, and called MCP `run_gate {}` GREEN. The staged
0.1.5 eval completed in 52.4 seconds on the author's arm64 macOS machine. The compact primary skill also
moved from 301 lines / 2,655 words to 99 lines / 745 words; lifecycle detail remains installed under
`references/lifecycle.md` and is loaded only for lifecycle work.

The structured comparison is committed at
[`evidence/model-adoption/2026-09-02.json`](../evidence/model-adoption/2026-09-02.json).
An attempted Claude Code arm is recorded separately at
[`evidence/model-adoption/claude-2026-09-02-attempt.json`](../evidence/model-adoption/claude-2026-09-02-attempt.json):
the installed default-client/model combination was version-refused and an explicit `sonnet` attempt
was quota-refused before inference. It is therefore an attempted-but-unexecuted arm, not a result.

## What this proves

It proves the deterministic mechanics required for a first AI-agent session: after the package is
installed and `onboard` completes, no extra skill copy or MCP registration command remains; the
agent receives explicit tool routing; and the read-only tool surface can observe and correct a live
architecture violation.

## What this does not prove

The required deterministic proof samples no language model. The optional eval samples one session,
which establishes only that the recorded behavior occurred—not a tool-selection success rate, task
completion uplift, token savings, cost reduction, or comparative agent quality. Both runs are
operated by BCE's author and therefore are not independent-human attestations. Those claims require
a separately designed, independently run study; the public witness count remains unchanged.
