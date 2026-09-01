# Project status

Last reviewed: 2026-09-01. This file is the authoritative public claim ledger for the current
source tree.

## Distribution

| Surface | Status | What a user may rely on |
|---|---|---|
| Source checkout | Working, internally tested | Node 22, `npm ci`, `npm run build`, then `node dist/cli.js` |
| Packed local tarball | Working, clean-room tested | `npm run test:package` installs the tarball outside the source tree and runs `bce demo` |
| npm | Released | [`bce-engine@0.1.3`](https://www.npmjs.com/package/bce-engine/v/0.1.3) is public with npm provenance; install the exact version on Node 22+ |
| Git tag / GitHub Release | Released | [`v0.1.3`](https://github.com/blueprint-conformance/bce/releases/tag/v0.1.3) is immutable and carries the release compliance report plus verified evidence record |
| GitHub Action | Released | Pin `blueprint-conformance/bce@v0.1.3` and `engine: bce-engine@0.1.3`; creator-maintained external RED/GREEN evidence is linked below |
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
  The drift run was advisory, so its successful workflow conclusion is not evidence of enforced
  blocking; its log is evidence that the generated Action found and reported the violation.

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
