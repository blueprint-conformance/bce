# Accelerated instrumentation pilot v1 result

Evidence class: **author-operated, development-exposed instrumentation pilot; permanently
ineligible for product-efficacy claims**.

- Frozen input root: `dfe5fbdd35e2ea0b9f16834eb7e3f3c145c7d774d757ff6214740767ad565e6f`
- Public pre-exposure anchor: [`415656e588cc96f3c0a313c8086bc1287824b31b`](https://github.com/blueprint-conformance/bce/commit/415656e588cc96f3c0a313c8086bc1287824b31b)
- Attempts retained: 8/8 in sealed global order (4 baseline, 4 BCE)
- Status: 8 `failed`, 0 `completed`, 0 infrastructure rows omitted
- Product decision: `ineligible-instrumentation-pilot-no-efficacy-decision`
- Public result digest: `c1ac3958d670dab11e895edc0167e5eb31f569227b89cf32217f61da88244985`

All eight Codex launches were blocked before inference because the outer sandbox denied reading the
NVM-installed Codex JavaScript artifact under the maintainer home directory. This was a controller
compatibility defect, not evidence about either randomized arm. No task change was produced, token
and cost telemetry remained missing, and no success, defect-reduction, latency, cost, or
policy-resistance inference is valid.

The failure is retained rather than retried. The fix-forward path is a separately identified and
separately sealed pilot whose controller stages and verifies the native client artifact inside its
disposable readable state. The v1 terminal commitments, ledger, non-restricted evidence, analysis,
and sanitized failure class are in [`results/summary.json`](results/summary.json). Raw model-client
transcripts remain outside the repository; their eight SHA-256 commitments are public in that
summary.
