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

## What this proves

It proves the deterministic mechanics required for a first AI-agent session: after the package is
installed and `onboard` completes, no extra skill copy or MCP registration command remains; the
agent receives explicit tool routing; and the read-only tool surface can observe and correct a live
architecture violation.

## What this does not prove

No language model is sampled, so this does not establish model tool-selection accuracy, task
completion uplift, token savings, or comparative agent quality. The run is operated by BCE's own
test harness and therefore is not an independent-human attestation. Those claims require a
separately designed, independently run study; the public witness count remains unchanged.
