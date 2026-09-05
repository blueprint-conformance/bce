# Accelerated instrumentation pilot v4 safety halt

Pilot v4 did not produce an efficacy result. Its sealed controller committed the first six of 24
frozen assignments, then fired the preregistered stop after six consecutive post-exposure
infrastructure failures. The remaining 18 assignments were never executed and are not outcomes.
The public archive proves the exact frozen prefix, terminal evidence, ledger chain, and halt only;
its `analysis` field is structurally `null`.

| Run fact | Verified value |
|---|---:|
| Frozen assignments | 24 |
| Committed prefix | 6 |
| Baseline exposures in prefix | 3 |
| BCE-enabled exposures in prefix | 3 |
| Unexecuted assignments | 18 |
| Terminal status | 6 infrastructure errors |
| Efficacy estimates produced | no |

## Exact apparatus failure

The sealed model name and digest matched before and after every attempt. Ollama's `/api/tags`
reported the frozen artifact size as `20,201,253,829` bytes, while `/api/ps` reported the active
model size as `31,232,580,640` bytes with a 40,960-token runtime context. The v4 runner incorrectly
required those two endpoint-specific size values to be equal even when the active name and digest
matched. It therefore classified every attempt as an infrastructure error before it could retain
the task result, final inventory, visible checks, or hidden oracles.

The six recorded `policyMutation=true` values are conservative failure placeholders, not observed
model behavior. Every corresponding policy artifact has empty `finalPolicyPaths`,
`observedWritePaths`, and `outOfScope` arrays. Because the v4 runner deleted its disposable
workspaces after committing the failure records, actual policy mutation and task success are
unknown. No mutation rate may be calculated from these records.

Restricted transcripts provide an additional operator-derived apparatus warning: two client
processes exited zero, four reached the 360-second wall, five contain 36 aggregate unsupported
tool-call routing errors, and none contains an accepted command, file-change, or MCP event. The
transcript bytes remain private; the public archive contains their exact commitments. These facts
indicate that the Codex/Ollama/Qwen tool loop was not qualified. They do not measure BCE.

## What the archive proves

- all six records are primary attempts at order indexes 0–5 of the sealed global order;
- the ledger is an intact hash chain ending at
  `dc460aa27d08fda7e6e9faf9206ebc922f9a9725c560c863c625fc2e82869a5c`;
- the frozen stop rule first became true on the sixth committed record;
- public artifacts replay from content-addressed storage while six restricted transcripts remain
  excluded and bound by digest;
- self-rehashed efficacy injection, result-type confusion, halt tampering, and ledger truncation
  are rejected by the public verifier.

Integrity anchors:

- Public seal commit: `c3422250a87aefa322d37211fe44d7f431917435`
- Seal root: `810a718845a797bd8e766178e004e39e35506c7ca6a37cf0e5c74b35c3a03816`
- Public archive digest: `528b851e2bc88419666a1c90bb5257e6e3ea97434e84252b7c01795986ba752b`
- Claim decision: `not-evaluated-safety-halted-partial-run`

## Fix-forward boundary

V4 is terminal. It will not be resumed, resealed, or repaired in place. A v5 may proceed only with
a new study identifier, task bytes, randomization seed, denominator, and public seal. Before v5 is
frozen, a sacrificial non-study canary must prove the exact local client/model/sandbox tool loop can
execute a command, edit one allowed file, emit usable telemetry, produce zero unsupported-router
errors, and—in the BCE path—complete a real MCP gate call. The provider proof must bind exact
pre/post tag identity and active name/digest while treating active allocation size as diagnostic.

This is a safety-halted apparatus record. It contains no efficacy estimate, arm comparison,
cost/latency comparison, uplift claim, safety claim, default-adoption claim, transportability claim,
or product recommendation. The held-out 600-trial confirmatory study and independent replication
remain unrun.
