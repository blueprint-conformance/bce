# Project status

Last reviewed: 2026-09-05. This file is the authoritative public claim ledger for the current
source tree.

## Distribution

| Surface | Status | What a user may rely on |
|---|---|---|
| Source checkout | Working, internally tested | Node 22.22.2, `npm ci`, `npm run build`, then `node dist/cli.js`; published runtime remains Node 22+ |
| Packed local tarball | Working, clean-room tested | `npm run test:package` installs the tarball outside the source tree and runs `bce demo` |
| npm | Released | [`bce-engine@0.2.0`](https://www.npmjs.com/package/bce-engine/v/0.2.0) is public with SLSA provenance and integrity `sha512-hFKOHO+EYgQbp+jaOW7/WTBGEqjHDEEKfB+O1ALo8KLnmIAr708mQWeXxRUMi3YAmWxz1RhfiAY1Rdpk81NNrA==`; install the exact version on Node 22+ |
| Git tag / GitHub Release | Released, immutable | [`v0.2.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.2.0) is immutable at source `14716bf655d8dd6020b9dcf8905678ef2abe2760`; it froze before asset upload, so the exact signed record is preserved in the separate [`evidence-v0.2.0`](https://github.com/blueprint-conformance/bce/releases/tag/evidence-v0.2.0) immutable release ([verification record](docs/release-v0.2.0.md)) |
| GitHub Action | Released | Pin `blueprint-conformance/bce@14716bf655d8dd6020b9dcf8905678ef2abe2760` (the v0.2.0 source commit), never a tag; the creator-maintained external RED/GREEN witness below remains evidence for its recorded v0.1.5 Action pin, not v0.2.0 |
| GitLab template | Unsupported reference | It uses exact `bce-engine@0.2.0` and is fail-closed, but no real GitLab runner/client matrix has been completed; GitLab is not a supported integration |
| OpenAI plugin | Packaged, unsubmitted | `.codex-plugin/plugin.json` validates as a skills-only ChatGPT/Codex plugin; there is no portal submission, public listing URL, or clean-account directory install |

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
- The v0.2.0 release evidence embeds the exact dependency-lock digest and extractor/provider
  identity. Its reproducibility proof obtains the same production graph and report hash from two
  clean installs. Historical 0.1.5 records predate this additive field.
- The built MCP server passes strict discovery through locked Inspector 2.5.0, boundary/framing
  tests, and a 2-second startup/discovery p95 gate. This is Inspector compatibility, not proof of
  every named host client.
- The synthetic scale track scans 2,000 TypeScript files, enforces a 30-second p95 ceiling, and
  requires a planted final-package import to redden at its exact line. It is a regression budget,
  not real-monorepo generalization evidence.
- The v0.2.0 source and packed artifact passed the public Ubuntu/macOS/Windows × Node 22/24
  [portability matrix](https://github.com/blueprint-conformance/bce/actions/runs/33709587798), including
  build, typecheck, cross-platform engine/CLI/evidence/MCP tests, restricted-network operation, and
  a packed-consumer proof. This establishes the current source path, not a retrospective claim that
  every platform executed the historical `v0.1.5` release workflow.
- The v0.1.5 GitHub Action ran outside this repository: the public
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
  (see the consumer's `WITNESS.md`), so it does not change the independent-witness count below, and
  the sequence has not yet been rerun against the v0.2.0 Action commit.
- The v0.2.0 AI-adoption proof runs all four supported harness layouts. It checks project-local
  discovery of both skills, project-local MCP configuration, read-only tool affordances,
  zero-argument repository calls, and live GREEN → RED → GREEN correction. This is a deterministic
  agent-harness simulation, not an LLM comparison or independent-human usability evidence.
- The restricted-network proof blocks Node network APIs and supplies hostile proxy and registry
  settings while validation, GREEN/RED gating, evidence verification, and MCP discovery run. It
  establishes local operation after installation, not cold installation from a private registry.
- The opt-in model-adoption eval samples an authenticated Codex session and scores observable JSONL
  skill reads, MCP calls, the git diff, policy preservation, and RED → GREEN. The 2026-09-02 paired
  author-operated sample changed tool selection from CLI to MCP after the routing instructions were
  corrected. One sample is not a success-rate estimate, model comparison, or independent witness.
- The engine self-blueprint has 45/45 separately materialized source mutants killed through the
  production extractor/evaluator path. CI regenerates and freshness-checks the mapping, rejects
  invalid or collateral mutants, and requires the real proof. This establishes that the current 45
  clauses can redden on real source changes; it does not establish specification completeness.
- The model-evaluation controller has a no-model rehearsal over the exact eight-attempt pilot
  topology. It proves read-default-deny isolation, host/protected-surface write denial, hidden-input
  read denial, exact client/Node staging, positive generated-config MCP negotiation, copied-auth
  retirement before the fixture model-command phase, twice-run filesystem/network-isolated
  oracles, artifact-backed terminal records, caught-failure terminalization, hard-crash recovery,
  public aggregate recomputation, and restricted-transcript exclusion. Synthetic rehearsal is
  machinery evidence only.

## What has not been established

- The AI-first `propose`/review surface is released in v0.2.0 and passes deterministic source and
  packed-consumer proofs. No independent user has yet completed or evaluated that proposal journey;
  its usability or benefit relative to manual authoring is not established.
- No independent user witness has completed the adoption journey. The external consumer above
  is creator-maintained and therefore does not change the independent-witness count.
- The author-designed seeded corpus is a regression suite, not a held-out benchmark.
- No controlled study shows that BCE improves autonomous-agent outcomes, completion rate, cost,
  or escaped-defect rate relative to a baseline.
- The canonical four-cell, baseline/BCE 240-attempt confirmatory design exists, but its exact
  provider-identified clients/models, ten held-out repositories, thirty tasks/reference patches,
  isolation driver, BCE artifact, assignment proof, and public Sigstore seal are unset. Readiness
  therefore refuses and no comparative result is claimed.
- Accelerated instrumentation pilot v1 was publicly sealed before exposure and retained all eight
  attempts. All eight client invocations exited before a model response or task change was observed
  because the outer sandbox also denied the NVM-installed Codex artifact under the maintainer home;
  zero upstream inference is not observable. This is controller compatibility evidence, not an arm
  comparison; no task, cost, latency, defect, or policy-resistance benefit is inferred. The public
  result preserves the ledger and non-restricted artifacts while binding eight restricted
  transcripts by digest. A fix-forward pilot requires a new identifier and seal. Codex also exposes
  only requested model configuration, not a provider-returned model identity, so its rows cannot
  receive safe-success identity credit. Pilot v2 then retained 8/8 completed client sessions but
  0/8 task successes: Codex's inner `workspace-write` sandbox could not initialize inside the
  controller's outer macOS sandbox, so no task changed and no BCE mechanism use was observed. Its
  staged runtime, read-default-deny probes, offline BCE closure, ledger, oracles, public export, and
  aggregate replay all worked. V2 is apparatus-failure evidence only and requires a new identifier
  plus seal for any fix-forward run. The v3 builder makes the frozen deny-by-default outer profile
  the sole sandbox owner; Codex's inner sandbox is disabled only inside that inherited boundary,
  and the deterministic client fixture fails if the adapter reintroduces nested sandboxing. Pilot
  v3 then completed 8/8 attempts with 4/4 hidden functional and architecture success in each arm,
  zero escaped defects, and zero policy mutations. That is apparatus validation, not uplift: the
  easy development tasks saturated both arms, no BCE skill/MCP use was observed, only one
  model-initiated BCE gate call was observed, cost was unavailable, and model identity remained
  requested configuration rather than provider-returned evidence.
- No conventional precision/recall study with independent annotation has been completed.
- No paper, arXiv identifier, DOI, archival artifact, or independent replication is claimed.
- No external implementation has submitted a complete run against the digest-frozen 12-vector set;
  the accepted implementation count remains zero.
- The v0.2.0 EvidenceRecord has authenticated Sigstore identity bound to the GitHub OIDC issuer and
  exact `release.yml@refs/tags/v0.2.0` workflow identity. The canonical immutable Release froze before
  its assets uploaded; the Rekor-recovered bundle and exact record are therefore held by the separate
  immutable evidence release. [The release record](docs/release-v0.2.0.md) preserves the failure and
  fix-forward. This establishes producer identity for the release evidence, not product efficacy.
- The OpenAI skills-only plugin archive validates locally, but required operator identity/legal
  materials and portal review are incomplete; it is not publicly listed.
- This repository's `main` requires seven CI contexts: `build-test-prove`, `lane-b-self-gate`,
  `lane-a-pinned-gate`, `leakage-gate`, `banned-phrases`,
  `launch promises (inert while private, blocking once public)`, and
  `model-evaluation-controller-macos`. GitHub enforces them for admins
  and blocks force-push and deletion. It requires zero human approvals and has no release-environment
  reviewer because the project currently has one human maintainer; configuring a second-person gate
  would deadlock it. Independent review is not claimed. Adopters must configure policy owners
  appropriate to their own team size.

## Claim-change rule

A row moves from “not released/not established” only in the same reviewed change that links the
immutable public artifact or reproducible evidence. Aspirational identifiers and future release
commands do not count as evidence.
