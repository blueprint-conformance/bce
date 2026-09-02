# Scale and detection evidence

Product regression evidence and empirical generalization are different claims.

`npm run test:scale` builds a deterministic synthetic TypeScript monorepo with 20 packages and 2,000 files. It runs three full AST gates, requires all 2,000 files to be reported as scanned, enforces a 30-second p95 budget, then plants a forbidden dependency in the final package and requires a RED verdict naming the exact file and line. This is a release-gated performance regression track, not evidence about arbitrary real-world monorepos.

The packaged seeded corpus remains development data. A held-out detection estimate is blocked by `npm run research:readiness` until the preregistration is frozen before access, the corpus manifest is sealed and checksummed, and cases exist. The planned analysis requires independent annotation, false positives and unsupported cases in the denominator, Wilson intervals, and per-defect-class reporting. Current status remains “not run.”

The controlled coding-agent study is separately blocked by `npm run research:study-readiness` until its model families, repositories, assignments, and blinding are frozen. A Codex sample and a refused Claude Code attempt are operational observations, not comparative efficacy evidence.
