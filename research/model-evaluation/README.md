# BCE product-efficacy study v2

This directory is the canonical contract for measuring whether the **BCE adoption bundle** changes
coding-agent outcomes. The primary outcome is not a BCE invocation or a green BCE report. It is
**safe successful completion**:

1. the complete visible pipeline accepts the change;
2. the frozen hidden functional oracle passes;
3. the frozen BCE-independent architecture oracle passes;
4. no protected policy, test, evaluator, agent-configuration, or CI surface was changed; and
5. the randomized attempt completed within its frozen budget.

The baseline and BCE arms receive the same repository, task prompt, written architecture rule,
client/model, permissions, network policy, and resource budget. The only allowed treatment delta is
the sealed BCE artifact, blueprint, project skill/MCP configuration, and visible BCE done-check.
That estimates the effect of the **whole adoption bundle**, not the isolated engine or any one MCP
tool.

## Evidence classes

- `protocol`: machinery and preregistration only; no efficacy result.
- `pilot`: author-operated instrumentation/calibration on development-exposed tasks that are
  permanently excluded from confirmation.
- `confirmatory`: author-operated randomized evidence for the exact frozen task/client/model matrix.
- `independent-replication`: reserved for a genuinely separate operator and never inferred from
  automation or multiple model agents.

A solo maintainer can run a causal comparison inside a frozen task set by using deterministic
machine oracles outside the agent workspace. A solo maintainer cannot manufacture independent human
adjudication. Raw blinded human labels remain an optional later evidence layer.

## Lifecycle

```text
draft inputs -> generate assignments -> verify -> seal publicly -> execute once
             -> verify append-only artifacts -> analyze offline -> claim-scope lint
```

`protocol.v2.json` and `task-manifest.json` deliberately remain unready until real repositories,
tasks, client artifacts, model identities, oracles, and a public pre-run seal are present. The
readiness command must refuse that state:

```sh
npm run research:model-eval-readiness
```

The protocol self-test drives the same verifier and analyzer through a fully materialized synthetic
240-trial bundle, then proves they reject arm-blocked assignment, missing/modified artifacts,
self-asserted outcomes, policy weakening, incomplete denominators, and missing telemetry presented
as zero. Synthetic results are harness tests only and are ineligible for product claims.

The real-controller self-test uses the separate eight-attempt pilot with a deterministic no-model
fixture. It proves the macOS sandbox denies hidden-input reads and protected/host writes, both arms
reach the real visible pipeline and twice-run hidden oracles, caught post-exposure exceptions become
terminal ITT failures, a killed controller recovers its immutable exposure journal without losing
the denominator, and restricted transcripts are excluded from the public export while their
digests remain committed:

```sh
npm run build
npm run test:model-eval-controller
```

The accelerated real-model pilot lives under `pilots/accelerated-v1/`. Its intended lifecycle is:

```sh
npm run build:model-eval-pilot                 # only before the generated path exists
node scripts/verify-model-evaluation-bundle.mjs --bundle research/model-evaluation/pilots/accelerated-v1
npm run model-eval:run -- --bundle research/model-evaluation/pilots/accelerated-v1 --execute-sealed-study
npm run model-eval:analyze -- --bundle research/model-evaluation/pilots/accelerated-v1 --runs "$RESTRICTED_RUNS"
npm run model-eval:export-public -- --bundle research/model-evaluation/pilots/accelerated-v1 --runs "$RESTRICTED_RUNS" --out research/model-evaluation/pilots/accelerated-v1/results
```

Sealing is intentionally omitted from the copy-paste block because it requires a public pre-run
commit anchor. Selective trial execution is refused: the controller consumes the exact sealed
global order. The pilot's Codex client records an accepted requested model but no provider-returned
model identifier, so those rows cannot satisfy the protocol's `modelIdentityVerified` component of
safe successful completion even if all task/oracle checks pass. Confirmatory cells must provide a
provider-response identity.

## Canonical files

- `protocol.v2.json` — estimand, intervention, thresholds, isolation, stopping, and analysis policy.
- `task-manifest.json` — repositories, tasks, artifact references, and generated paired assignments.
- `treatment-delta.v1.json` — the complete list of surfaces allowed to differ between arms.
- `protected-paths.v1.json` — policy/evaluator surfaces that make safe success false if touched.
- `schemas/` — closed schemas for protocol, task manifest, terminal records, and seal.
- `seal.json` — content-addressed pre-run bundle root; never backfilled after trial one.

The legacy top-level model-evaluation files are retained as explicit pre-trial supersession records
or compatibility entrypoints. There is one canonical study, not overlapping two-arm and three-arm
stories.
