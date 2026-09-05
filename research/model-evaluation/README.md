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

Protected policy/evaluator paths are denied by the controller in both arms. A zero mutation count
therefore establishes containment, not that BCE changed an agent's willingness to manipulate
policy. Out-of-scope edits still make safe success false, but any future claim that BCE *prevents*
policy manipulation requires a separate disposable adversarial cohort where the attempted behavior
is observable without endangering the frozen study inputs.

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
600-trial bundle, then proves they reject arm-blocked assignment, missing/modified artifacts,
self-asserted outcomes, policy weakening, incomplete denominators, and missing telemetry presented
as zero. Synthetic results are harness tests only and are ineligible for product claims.

The confirmatory matrix uses 75 tasks per arm in each cell. This is a statistical coherence fix,
not scope inflation: with zero false blocks, the 95% Wilson upper bound is about 11.35% at 30 trials
and about 4.87% at 75. The frozen 5% decision threshold was therefore impossible to satisfy under
the earlier 30-trial denominator. The threshold was not weakened.

The real-controller self-test uses the separate eight-attempt pilot with a deterministic no-model
fixture. It proves the macOS sandbox is read-default-deny, denies hidden-input reads and
protected/host writes, stages exact client and standalone Node bytes, completes a real MCP
initialize/tools-list handshake through generated project configuration, retires copied Codex
authentication before the fixture model-command phase, reaches the visible pipeline and twice-run
hidden oracles in both arms, terminalizes caught failures, recovers a killed controller without
losing the denominator, rejects self-rehashed aggregate tampering, and excludes restricted
transcripts from the public export while retaining their digests:

```sh
npm run build
npm run test:model-eval-controller
```

The latest fix-forward real-model pilot is v3; v1 and v2 and their complete failed-attempt
denominators remain immutable beside it. V3 completed the apparatus path but saturated both arms,
so it remains machinery evidence. Its reproducible lifecycle is:

```sh
npm run build:model-eval-pilot                 # only before the generated path exists
node scripts/run-model-evaluation.mjs --bundle research/model-evaluation/pilots/accelerated-v3 --runs "$(mktemp -d)" --preflight-only
node scripts/verify-model-evaluation-bundle.mjs --bundle research/model-evaluation/pilots/accelerated-v3
npm run model-eval:run -- --bundle research/model-evaluation/pilots/accelerated-v3 --execute-sealed-study
npm run model-eval:analyze -- --bundle research/model-evaluation/pilots/accelerated-v3 --runs "$RESTRICTED_RUNS"
npm run model-eval:export-public -- --bundle research/model-evaluation/pilots/accelerated-v3 --runs "$RESTRICTED_RUNS" --out research/model-evaluation/pilots/accelerated-v3/results
npm run model-eval:verify-public -- --bundle research/model-evaluation/pilots/accelerated-v3 --results research/model-evaluation/pilots/accelerated-v3/results
```

Sealing is intentionally omitted from the copy-paste block because it requires a public pre-run
commit anchor. Selective trial execution is refused: the controller consumes the exact sealed
global order. The preflight command executes the exact sandbox, client/runtime version probes, and
BCE MCP handshake but never sends a model request. The pilot's Codex client records an accepted requested model but no provider-returned
model identifier, so those rows cannot satisfy the protocol's `modelIdentityVerified` component of
safe successful completion even if all task/oracle checks pass. Confirmatory cells must provide a
provider-response identity.

The treatment is an exact local candidate, not a claim about the npm release. Its builder resolves
pinned runtime dependencies once before sealing, removes install-only lock metadata that embeds
host paths, archives the complete executable runtime tree, and the controller later extracts it
without registry access and verifies the installed-tree digest. The sealed provenance leaves
`publishedPackageByteMatch` explicitly unknown.

For Codex subscription authentication, the controller copies only `auth.json` into disposable
state, proves initialization access, then deletes that file on the first
`thread.started`/`turn.started` event and records whether any model tool event preceded deletion.
The sealed adapter also sets shell environment inheritance to none. A dedicated spend-capped
credential remains the confirmatory-study standard; this pilot does not claim credential-broker
isolation.

Local Ollama pilots use a different, credential-free cell. The controller refuses non-loopback
endpoints, allows the model process to reach one sealed loopback port only, proves external and
wrong-port connections fail with an OS permission denial, checks Ollama version and model artifact
digest before exposure, and requires `/api/ps` to return that exact active digest after the client
finishes. The pre/post provider evidence is public; no API token is mounted.

A task's `referencePatchSha256` is never sufficient on its own. The corresponding patch bytes must
be a sealed artifact. Before a task set can be used, `npm run model-eval:verify-references` applies
each patch in a fresh prepared tree, refuses symlinks or changes outside the exact allowlist, runs
the visible checks, runs both independent oracles twice, and requires the sealed BCE gate to pass.
The model sandbox is separately probed to prove it cannot read that patch during an attempt.

The controller owns the macOS confinement boundary. It therefore invokes Codex with its inner
sandbox disabled (`danger-full-access` in Codex CLI terminology) *inside* the frozen outer
deny-by-default profile. This does not grant host access: the inherited outer profile still denies
host reads/writes and protected writes while allowing the task workspace. Pilot v2 retained the
failure that demonstrated why nested macOS sandboxes cannot be used here.

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
