# Project status

Last reviewed: 2026-09-02. This file is the authoritative public claim ledger for the current
source tree.

## Distribution

| Surface | Status | What a user may rely on |
|---|---|---|
| Source checkout | Working, internally tested | Node 22, `npm ci`, `npm run build`, then `node dist/cli.js` |
| Packed local tarball | Working, clean-room tested | `npm run test:package` installs the tarball outside the source tree and runs `bce demo` |
| npm | Released | [`bce-engine@0.1.5`](https://www.npmjs.com/package/bce-engine/v/0.1.5) is public with npm provenance; install the exact version on Node 22+ |
| Git tag / GitHub Release | Released | [`v0.1.5`](https://github.com/blueprint-conformance/bce/releases/tag/v0.1.5) is immutable and carries the release compliance report plus verified evidence record |
| GitHub Action | Released | Pin `blueprint-conformance/bce@v0.1.5` and `engine: bce-engine@0.1.5`; creator-maintained external RED/GREEN evidence is linked below |
| GitLab template | Dormant | It deliberately exits 2 until an exact real release is supplied |

## What the engine currently proves

- For supported extractor/constraint combinations, it can discriminate committed conformant and
  seeded-drift fixtures and produce deterministic reports.
- Gate outcomes are three-state: pass (exit 0), violation (exit 1), and structural refusal
  (exit 2). A missing blueprint set, unsupported critical analysis, unknown constraint, unbound
  runtime constraint, unsafe evidence path, or unresolved allowlist destination cannot pass.
- Route-guard evidence requires symbol provenance from a blueprint-declared governed module.
- Runtime observation envelopes are bound to revision, scanned source bytes, extracted graph,
  probe definition, stimulus set, collector, and environment before they can affect a verdict.
- `bce run --emit` can emit hash-chained integrity records. Ordinary gate runs do not emit them,
  and a local hash chain is not authenticated provenance.
- The generated GitHub Action runs outside this repository: the public
  [`blueprint-conformance/bce-action-witness`](https://github.com/blueprint-conformance/bce-action-witness) consumer
  produced a [clean GREEN](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33497921200),
  [reported planted drift](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33497995578),
  and returned to [GREEN after the fix](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33498058816).
  That drift run was advisory, so its successful workflow conclusion is not evidence of enforced
  blocking; its log is evidence that the generated Action found and reported the violation.
  On 2026-09-03 the same consumer was graduated with `bce graduate` (`.bce-mode.json` → `enforced`,
  ceremony record `.blueprints/GRADUATION.md`) and the sequence was replayed under the enforced
  posture with the same immutable Action pin:
  [clean GREEN](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33689516050) →
  [planted drift **FAILED the run**](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33689961361)
  (`forbidden-dependency-axios` at `src/billing.extension.ts#L1`, score 60, workflow conclusion
  `failure`, exit 1) →
  [GREEN after the fix](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33690296051).
  That RED is evidence of enforced blocking in an external consumer. It remains creator-maintained
  (see the consumer's `WITNESS.md`), so it does not change the independent-witness count below.
- The source-tree AI-adoption proof runs all four supported harness layouts. It checks project-local
  discovery of both skills, project-local MCP configuration, read-only tool affordances,
  zero-argument repository calls, and live GREEN → RED → GREEN correction. This is a deterministic
  agent-harness simulation, not an LLM comparison or independent-human usability evidence.
- The opt-in model-adoption eval samples an authenticated Codex session and scores observable JSONL
  skill reads, MCP calls, the git diff, policy preservation, and RED → GREEN. The 2026-09-02 paired
  author-operated sample changed tool selection from CLI to MCP after the routing instructions were
  corrected. One sample is not a success-rate estimate, model comparison, or independent witness.

## What has not been established

- No independent user witness has completed the adoption journey. The external consumer above
  is creator-maintained and therefore does not change the independent-witness count.
- The author-designed seeded corpus is a regression suite, not a held-out benchmark.
- No controlled study shows that BCE improves autonomous-agent outcomes, completion rate, cost,
  or escaped-defect rate relative to a baseline.
- No conventional precision/recall study with independent annotation has been completed.
- No paper, arXiv identifier, DOI, archival artifact, or independent replication is claimed.
- Branch protection and policy-owner enforcement must still be configured by each adopter.

## Claim-change rule

A row moves from “not released/not established” only in the same reviewed change that links the
immutable public artifact or reproducible evidence. Aspirational identifiers and future release
commands do not count as evidence.
