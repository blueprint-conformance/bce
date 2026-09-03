# Scale and detection evidence

Product regression evidence and empirical generalization are different claims.

`npm run test:scale` builds a deterministic synthetic TypeScript monorepo with 20 packages and 2,000 files. It runs three full AST gates, requires all 2,000 files to be reported as scanned, enforces a 30-second p95 budget, then plants a forbidden dependency in the final package and requires a RED verdict naming the exact file and line. This is a release-gated performance regression track, not evidence about arbitrary real-world monorepos.

The packaged seeded corpus remains development data. A held-out detection estimate is blocked by `npm run research:readiness` until the preregistration is frozen before access, the corpus manifest is sealed and checksummed, and cases exist. The planned analysis requires independent annotation, false positives and unsupported cases in the denominator, Wilson intervals, and per-defect-class reporting. Current status remains “not run.”

The canonical controlled coding-agent study is separately blocked by `npm run research:model-eval-readiness` until its exact provider-identified client/model cells, held-out repositories and tasks, reference patches, assignments, isolation driver, BCE artifact, and public Sigstore seal are frozen. The eight-attempt accelerated development pilot exercises the controller but is permanently ineligible for efficacy claims. Existing Codex/Claude observations are operational evidence, not comparative product evidence.
