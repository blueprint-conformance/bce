# BCE product-efficacy studies

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

## Evidence Foundry v3: primary answer first

The forward confirmatory program is registered in `studies/index.v3.json`. It starts with one
bounded primary cell over 40 repository clusters and three task shapes per repository: 120 paired
tasks, or 240 retained attempts. Three preregistered transport cells follow only after the primary
stage completes. This staging avoids making the first bounded causal answer wait for all four
client/model cells; it does not broaden that answer beyond the exact primary cell, release bytes,
and frozen task population.

The v3 registry binds the arm-blind deterministic evaluator and rubric, the run-registration and
durability contract, per-terminal checkpoints, exact changed-file replay bytes, immutable legacy
archives, and the pre-access power calculation. Registry validity and stage readiness are separate
checks: the initial frozen gate and default readiness report cover the exact primary stage, while
each later transport stage is selected explicitly after its dependency completes:

```sh
npm run research:evidence-foundry-v3
npm run research:evidence-foundry-v3-ready -- --stage primary-confirmatory
```

The second command currently exits `2` because the real task manifest, release artifact and
attestation, assignment seal, and exact primary client/model qualification are deliberately absent.
Those are evidence inputs, not values this repository can truthfully synthesize. The evaluator and
integrity locks are already byte-bound and verified. A target stage cannot become ready from those
digests alone: it must also pass the complete sealed v2 confirmatory-bundle verifier, including the
task/oracle artifacts, regenerated paired assignments, two-arm capability attestation, frozen
implementation bytes, treatment runtime, and Sigstore pre-run seal. A lifecycle string cannot
unlock an efficacy claim; completion also requires full-denominator public replay plus an external,
self-digested checkpoint anchor.

The lifecycle is the last **publicly verified** state, not an operator progress flag. The registry
refuses `frozen-ready-not-run` unless the complete readiness matrix recomputes green. During private
execution that remains the public state. A stage may move to `running` only after its complete
terminal records, registered ledger, checkpoint chain, and sanitized public result replay are
published; here `running` means “complete result awaiting the fixed GitHub OIDC anchor,” not an
unevidenced live pulse. A safety halt similarly requires the replayable non-empty halted prefix.
Both states derive the first heldout-access timestamp and current ledger head from public terminal
bytes. After a complete replay is committed, the anchor path is selected by that stage's sealed
`lifecycleEvidence`, never by a workflow caller:

```sh
gh workflow run evidence-foundry-anchor.yml \
  -f source_commit=MAIN_COMMIT \
  -f stage_id=primary-confirmatory \
  -f protocol_path=research/model-evaluation/studies/evidence-foundry-v3/protocol.json
```

Each stage owns a one-cell v2 execution bundle. That cell is `primary` within its stage-local paired
experiment; v3 separately classifies the stage as the program primary or a transportability stage.
Claim-bearing local-provider cells are admitted only for the first-party tool client with its exact
sealed two-arm capability qualification. Other local-provider clients remain pilot-only.

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

The v2 protocol self-test drives the same verifier and analyzer through a fully materialized synthetic
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

The latest completed public real-model design is v6; v1 through v4 and every exposed denominator
remain immutable beside it. V3 completed the apparatus path but saturated both arms. V4 was a faster,
permanently claim-ineligible calibration: four dependency-free JavaScript module-graph
microcosms, three distinct base states (`repair`, `feature`, and `refactor`) per repository, two
paired arms, and one exact content-addressed local Codex/Ollama `qwen3:32b` cell, for 24 retained
attempts. It safety-halted after the exact first six assignments because of a post-run provider
identity comparator defect; 18 assignments were never executed, and no analysis was produced.
[The v4 result](pilots/accelerated-v4/RESULTS.md) is an integrity-verified apparatus-failure archive,
not efficacy evidence. A local v5 candidate later completed but the pre-push leakage gate refused
publication of its sealed private path. V5 remains immutable and unpublished. V6 fixed forward
without rewriting it: a separately qualified exact local `qwen3:8b` cell, four new repository
microcosms, eight new repair/refactor tasks, paired arms, and 16 retained attempts.

[The v6 result](pilots/accelerated-v6/RESULTS.md) reports a small directional safe-success increase,
two baseline ITT escapes versus zero with BCE, two observed red-to-green corrections, and a 1.317x
paired median visible-time ratio. One baseline escape was normally completed; the other was
conservatively counted after an infrastructure timeout. Because the model was selected after the
earlier ceiling and the new tasks were development-authored, v6 is permanently claim-ineligible.
It supports the apparatus and the next research design, not product efficacy or default adoption.

Every v4 task freezes both a conforming reference patch and an architecture-violating shortcut
witness. The verifier requires the reference to pass visible checks, the twice-run functional and
independent architecture oracles, and the named BCE constraint. It requires the shortcut to pass
the same visible and functional checks while both independent architecture grading and BCE reject
the exact named constraint. It also proves the starting trees have different task-shape truth
tables: repair is functional-red/architecture-red, feature is functional-red/architecture-green,
and refactor is functional-green/architecture-red.

The historical v4 pre-exposure lifecycle was:

```sh
npm run build:model-eval-pilot -- --pilot-version v4 # clean source commit; generated path must not exist
npm run model-eval:verify -- --bundle research/model-evaluation/pilots/accelerated-v4 --draft
npm run model-eval:verify-references -- --bundle research/model-evaluation/pilots/accelerated-v4
npm run model-eval:run -- --bundle research/model-evaluation/pilots/accelerated-v4 --runs "$(mktemp -d)" --preflight-only
```

Sealing and execution are intentionally omitted from that block. Sealing requires the public commit
that first contains all unsealed input bytes; execution requires a later public seal commit. Only
then may the controller consume the exact global order once with `--execute-sealed-study`.
Selective trial execution is refused. The preflight command executes sandbox, client/runtime,
provider-identity, reference/shortcut read-denial, network-denial, and BCE MCP probes but never
sends a model request. V4 binds the provider-returned Ollama version, model name, content digest,
artifact size, and post-attempt active model. That identity strength does not widen the pilot's
claim scope.

Confirmatory treatment runtimes are derived only from the exact tarball retained by the registry
capture. The `evidence-foundry-runtime-derivation.yml` workflow verifies that tarball's npm/SLSA
provenance, installs it with pinned npm, archives the complete runtime tree, and signs a closed
input-package/output-runtime statement through the workflow's GitHub OIDC identity. The canary and
v3 verifier both reject a runtime whose archive or installed-tree digest differs from that statement;
new confirmatory bundles record `publishedPackageByteMatch: true`. Historical pilot archives keep
their original local-candidate provenance and remain claim-ineligible.

For Codex subscription authentication, the controller copies only `auth.json` into disposable
state, proves initialization access, then deletes that file on the first
`thread.started`/`turn.started` event and records whether any model tool event preceded deletion.
The sealed adapter also sets shell environment inheritance to none. A dedicated spend-capped
credential remains the confirmatory-study standard; this pilot does not claim credential-broker
isolation.

Local Ollama cells use a different, credential-free path. The controller refuses non-loopback
endpoints, allows the model process to reach one sealed loopback port only, proves external and
wrong-port connections fail with an OS permission denial, checks Ollama version and model artifact
digest before exposure, and requires `/api/ps` to return the exact active model name and digest
after the client finishes. `/api/tags.size` is retained as immutable artifact-size evidence;
`/api/ps.size`, `size_vram`, and `context_length` are separately retained as runtime diagnostics and
are never compared to artifact size. The pre/post provider evidence is public; no API token is
mounted.

Post-client evidence collection is ordered as a durability boundary. The controller first records
termination, usage, the final inventory, changed paths, and policy evidence; it then performs the
post-run provider attestation. A failed attestation can classify the attempt as infrastructure
error, but it cannot replace observed workspace evidence with empty fallback documents. Terminal
record v3 represents policy state with three facts: `policyAssessmentComplete`,
`policyMutationObserved`, and `policyFailClosedForOutcome`. Unknown assessment prevents safe
completion and adoption, but is not counted as observed policy manipulation.

### Sacrificial live capability canary

The canary creates its own one-file fixture and never reads or runs an evaluation task. It retains
two sacrificial attempts, one per arm, and qualifies an exact cell only when both attempts show a
successful command completion, the exact single allowed-file edit, usable turn/token telemetry,
stable provider name and digest, zero tool-router errors, and an exact successful BCE MCP `run_gate`
call in the BCE arm. Mentions, shell guesses, resource-list failures, and other MCP calls do not
count. A non-qualified canary is useful apparatus evidence but cannot authorize a new pilot.

```sh
node scripts/capture-evidence-foundry-registry.mjs \
  --version VERSION \
  --source-commit RELEASE_COMMIT \
  --out-dir PATH/TO/registry-capture

gh workflow run evidence-foundry-runtime-derivation.yml \
  -f source_commit=MAIN_COMMIT \
  -f release_source_commit=RELEASE_COMMIT \
  -f package_artifact_path=PATH/TO/bce-engine-VERSION.tgz \
  -f registry_record_path=PATH/TO/registry-verification.json \
  -f output_directory=research/model-evaluation/studies/evidence-foundry-v3/release-runtime

# After the workflow succeeds, download its artifact into the same output directory.
gh run download RUN_ID \
  --name evidence-foundry-registry-runtime-RELEASE_COMMIT \
  --dir research/model-evaluation/studies/evidence-foundry-v3/release-runtime

npm run model-eval:canary -- \
  --client bce-ollama-tool-client \
  --ollama-model MODEL \
  --reasoning-effort low \
  --runtime-derivation research/model-evaluation/studies/evidence-foundry-v3/release-runtime/runtime-derivation.json \
  --public-replay-root research/model-evaluation/studies/evidence-foundry-v3/qualification-primary \
  --out research/model-evaluation/studies/evidence-foundry-v3/qualification-primary/qualification-attestation.json
```

`--public-replay-root` is an explicit confirmatory mode. It accepts only the first-party client and
a new, normalized repository-relative directory whose parent already exists. After both registered
arms complete, it copies the sealed fixture and complete CAS/run ledger into the schema-fixed
`bundle/` and `runs/` paths beside canonical `terminal-records.jsonl`, emits a v2
attestation bound to the treatment release commit, and replays that attestation before atomically
publishing the standalone qualification directory. Copy that whole directory into the confirmatory
bundle and point the cell's sealed qualification-attestation path at its
`qualification-attestation.json`; replay paths resolve from that file's directory, so no nesting or
rewriting is needed. An incomplete or safety-halted denominator, a symlink, traversal, existing
destination, digest mismatch, or failed replay publishes nothing. Omitting the option preserves the
v1 diagnostic behavior; use `--restricted-runs /access-controlled/path` when retaining that private
evidence.

The canary exits `0` only when qualified and `4` when its completed v1 report is non-qualified.
Public replay mode instead refuses without publishing when the run cannot produce a fully replayable
v2 qualification. The
sealed study controller exits `0` only when the registered denominator is complete, `4` when an
operator limit leaves a resumable registered run incomplete, `3` for a valid safety halt, `2` for a
pre-exposure configuration refusal, and `1` for corruption or an unexpected controller failure. A
v2 halt binds the seal, protocol, manifest, runner, halt schema, exact ledger
bytes/head, canonical terminal prefix, and the first triggering rule/threshold/trial. Rerunning a
halted study verifies or materializes that halt and exits `3`; it never resumes the denominator.

A task's patch digest is never sufficient on its own. The corresponding reference and, where the
study design requires it, shortcut bytes must be sealed artifacts. Before a task set can be used,
`npm run model-eval:verify-references` applies each patch in a fresh prepared tree, refuses symlinks
or changes outside the exact allowlist, runs the visible checks, runs both independent oracles
twice, and reads the BCE machine report to distinguish a named violation from a refusal or an
unrelated red. The model sandbox is separately probed to prove it cannot read either solution
artifact during an attempt.

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
- `schemas/` — closed schemas for protocol, task manifest, terminal records, safety halts, and seal.
- `seal.json` — content-addressed pre-run bundle root; never backfilled after trial one.

The legacy top-level model-evaluation files are retained as explicit pre-trial supersession records
or compatibility entrypoints. There is one canonical study, not overlapping two-arm and three-arm
stories.
