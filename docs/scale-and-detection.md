# Scale and detection evidence

Product regression evidence and empirical generalization are different claims.

`npm run test:scale` builds two deterministic synthetic repositories: 2,000 TypeScript files and
2,000 Python files. Each provider runs three full structured gates, must report every declared file
as scanned, and has its own 30-second p95 budget. The proof then plants one forbidden dependency in
each language and requires a RED verdict naming the exact importer and line. This is a release-gated
performance regression track, not evidence about arbitrary real-world repositories.

The packaged seeded corpus remains development data. A held-out detection estimate is blocked by `npm run research:readiness` until the preregistration is frozen before access, the corpus manifest is sealed and checksummed, and cases exist. The planned analysis requires independent annotation, false positives and unsupported cases in the denominator, Wilson intervals, and per-defect-class reporting. Current status remains “not run.”

The canonical controlled coding-agent study is separately blocked by `npm run research:model-eval-readiness` until its exact provider-identified client/model cells, held-out repositories and tasks, reference patches, assignments, isolation driver, BCE artifact, and public Sigstore seal are frozen. The accelerated development pilots exercise and debug the controller but are permanently ineligible for efficacy claims. The latest [16-attempt v6 pilot](../research/model-evaluation/pilots/accelerated-v6/RESULTS.md) produced a directional architectural signal, two verified red-to-green corrections, and measurable time overhead, but used a post-ceiling-selected local model and development-authored tasks. It is instrumentation evidence, not product-efficacy evidence. Existing Codex/Claude observations remain operational evidence, not comparative product evidence.
