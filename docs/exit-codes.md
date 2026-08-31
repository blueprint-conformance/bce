# Exit codes

`bce` speaks in process exit codes so it drops into any CI as a required check without parsing
stdout. Three codes, one meaning each:

| code | meaning |
|---|---|
| **0** | **proven green** — the run graded and every selected contract passed. |
| **1** | **red or user error** — a graded violation, or a usage/config error. |
| **2** | **fail-closed refusal** — the run could not honestly grade (an empty scan, a malformed blueprint, an extractor that cannot honor a constraint). Deliberately distinct from a graded red: the engine is telling you it did *not* grade, rather than pretending a pass. |

Two consequences worth stating plainly:

- **A refusal is never a silent pass.** `2` exists precisely so that "I could not grade this" is
  never confused with "I graded this and it passed." A gate that scans zero files exits `2`, not `0`.
- **`gate` folds refusals into the build signal.** So a single CI check gates the merge, the `gate`
  verb reports a fail-closed refusal as a score-0 `fail` (exit `1`) — but the refusal *cause* stays
  legible in the report summary, so you can still tell a refusal apart from a graded red after the
  fact.

There is **one** designed exception to "1 = red": **advisory mode** (a committed
`.bce-mode.json`, not a flag) exits `0` on a red *verdict* by design — that is the adoption posture.
It still exits `1` on a config or usage error: advisory ungates the verdict, never the tool's own
honesty. See [`faq.md`](faq.md) for why advisory is a mode and not a `--skip` flag.

## The authoritative table

The per-command exit-code contract — every verb, every code — is normative in the specification and
is not duplicated here to avoid drift:

**→ [`spec/SPEC.md` §13 "Exit-code contract"](../spec/SPEC.md#13-exit-code-contract-reference-cli)**

That table covers `validate`, `author`, `scan`, `run`, `teeth`, `gate` (enforced and advisory),
`baseline`, `graduate`, and `portfolio`, including the exact conditions under which each returns `0`,
`1`, or `2`.

## Recommended next step

- [`report-contract.md`](report-contract.md) — the machine-readable report the gate emits alongside
  the exit code.
- [`../examples/quickstart/README.md`](../examples/quickstart/README.md) — see `0` and `1` produced
  by the same blueprint over two trees, offline.
