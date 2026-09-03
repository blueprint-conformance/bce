# Credibility hardening closeout — 2026-09-02

> Historical snapshot. The model-evaluation and self-teeth rows below describe the 2026-09-02
> candidate and are superseded by `STATUS.md`, `research/model-evaluation/protocol.v2.json`, and
> `docs/self-hosting.md`. In particular, the claim-bearing 240-trial inputs are now explicitly
> unpopulated/unsealed rather than described as frozen, and the current self-blueprint has a real
> 38/38 source-mutation proof.

This is the closeout ledger for the 15 workstreams in the corresponding
[implementation plan](credibility-hardening-plan-2026-09-02.md). “Implemented” means present and
locally verified in the candidate source tree; it does not turn an unmerged change into a release or
an author-operated run into independent evidence.

| # | Workstream | Candidate/source result | Honest remaining boundary |
|---:|---|---|---|
| 1 | Immutable releases | Repository immutable releases are enabled via the live GitHub API. Executable Action examples pin the v0.1.5 source commit. | Historical release v0.1.5 still reports `immutable:false`. A later release must demonstrate the new setting. |
| 2 | Vulnerability intake | GitHub private vulnerability reporting is live. `SECURITY.md` provides private-report and security-mailbox paths, safe-content guidance, and a seven-day acknowledgement target. | A non-maintainer reporting-UI test and mailbox acknowledgement are external operator exercises. |
| 3 | Independent adoption | A frozen target of three, closed record schema, structured issue intake, denominator reconciliation, and a negative control rejecting author-operated “independence” are release-gated. | Zero journeys started and zero accepted independent witnesses. Recruitment and runs require other people. |
| 4 | Independent review | Live `main` protection requires six checks, enforces them for admins, and blocks deletion/force-push. Human approval, CODEOWNER, and release-review requirements are deliberately disabled so a one-human project remains operable. Governance and release state state this limitation explicitly. | Independent review is unestablished. Activate second-person controls only when a distinct human accepts and can exercise the role; a nominal or maintainer-controlled account is not evidence. |
| 5 | Controlled agent efficacy | A frozen cross-harness protocol defines baseline/BCE arms, 240 minimum trials, intention-to-treat denominators, blinded dual adjudication, policy-mutation outcomes, Wilson intervals, and repository-cluster bootstraps. Analysis rejects missing trials and post-seal manifest edits. | The task/repository manifest and exact client/model identities are deliberately unset, so readiness refuses. No causal benefit, cost, or escaped-defect result exists. |
| 6 | Real-model/client evidence | Deterministic onboarding covers Agents, Claude, Cursor, and Codex layouts; one author-operated Codex sample is recorded. A refused Claude attempt is preserved rather than omitted. The future four-harness evaluation records exact client artifacts, model snapshots, tokens, cost, latency, failures, MCP use, and policy mutation. | Claude inference did not run because of client-version and quota refusals; the controlled 240-trial evaluation has not run and no multi-family estimate exists. |
| 7 | Supply chain/security settings | Every executable Action reference is a reviewed full SHA; unknown owners and mutable tags are negative-tested. Live Actions policy permits GitHub-owned actions only and requires SHA pins. Dependabot updates, secret scanning, and push protection are live; npm audit is zero. | GitHub reports non-provider patterns and validity checks disabled; they are not claimed. |
| 8 | Reproducibility identity | Runtime dependencies are exact, `npm-shrinkwrap.json` ships, evidence records identify lock digest/runtime/extractor provider, and two clean installs reproduce the production graph and report hash. | Historical v0.1.5 evidence lacks the additive toolchain identity. A new release is required. |
| 9 | Release adoption proof | Release gating now reruns deterministic Agent Skills/MCP adoption and a policy checker rejects its removal. | The new release workflow has not yet executed at a new immutable tag. |
| 10 | Detection and scale | A release-gated 2,000-file synthetic AST track enforces file coverage, 30-second p95, and an exact-line planted RED. The extractor was fixed from 48.8 seconds to 347.3 ms local p95 without reducing the track. | No independently annotated held-out corpus or real-monorepo performance distribution exists. Python remains an explicitly bounded line-scan MVP. |
| 11 | MCP compatibility | Locked Inspector 2.5.0 strict discovery, exact six-tool surface, version negotiation, framing limits, notification behavior, large output, and a 2-second discovery SLO are gated. | Named-host compatibility beyond the recorded Codex sample is not inferred from Inspector. In-flight synchronous calls cannot be preempted. |
| 12 | Claim consistency | Machine-readable release state and negative claim controls reconcile version, Action SHA, immutability history, schemas, GitLab status, listings, witnesses, and governance. Stale Lane-A and launch text was corrected. | Claim checks cannot prove facts outside their explicit inputs; public links/settings must still be re-read at release time. |
| 13 | Distribution listings | Listing copy uses exact install pins, public URLs, strict plugin validation, and an explicit allowed-claims table. A native OpenAI `.codex-plugin/plugin.json` packages both skills as skills-only; BCE's validator and the canonical `plugin-creator` validator pass. A submission dossier contains the required five positive and three negative cases. State is machine-checked as `unsubmitted`. | No OpenAI or Claude directory submission, review, listing URL, or clean-account listing install exists. OpenAI identity, legal URLs, final logo, regions, attestations, and portal publication remain operator-owned. |
| 14 | External specification implementation | The 12-vector set is digest-frozen. A closed external-report schema, verifier, issue intake, and negative control rejecting BCE itself are present. | Accepted external implementations: zero. No certification level or neutral governance is claimed. |
| 15 | Portability and signed identity | Exact Node toolchains, a six-leg Ubuntu/macOS/Windows × Node 22.22.2/24.15.0 workflow, and keyless Sigstore release attestation with issuer/workflow constraints are configured. A network-denial hook proves validate, GREEN/RED gate, evidence verification, and MCP discovery remain local under hostile proxy and registry settings. | The new public matrix has not run, successful installation from an enterprise private registry has not been exercised, and historical v0.1.5 has no Sigstore evidence bundle. Hashes prove integrity; authenticated producer identity awaits a new release. |

## Verification record

Local verification used Node 22.22.2 unless stated otherwise:

- Full suite: 59 files, 781 tests passed.
- Build and typecheck: passed.
- Packed consumer and full-stack onboarding: passed, including CLI/MCP binaries and RED → fix → GREEN.
- Reproducibility: two clean installs; lock digest `407f32dd8972d110ea7eb69eb8482f352fd7412e939eff5c830e022b9dee3274`; report hash `ccd1b1e4f16a63d6f15d54dcd929878ffbf47a95f19b3124b78cfab8d90a333e`.
- MCP: Inspector 2.5.0 strict discovery passed; local 10-run p95 156.8 ms against 2,000 ms.
- Scale: 2,000 files; local three-run p95 324.2 ms against 30,000 ms; planted RED passed.
- Restricted network: the network negative control fired; local validation, GREEN/RED gate, evidence verification, and MCP discovery passed under hostile proxy/registry settings.
- Model evaluation protocol: a complete synthetic 240-trial analysis passed; policy mutation stayed in the denominator; post-seal tampering and a missing trial were refused; live readiness correctly refused unset inputs.
- OpenAI plugin: repository and negative-control validators passed; OpenAI's canonical `plugin-creator` validator passed the same skills-only archive.
- Action pins, release policy, release claims, adoption programme, external implementation contract, docs topology, badge derivation, launch readiness in public mode, self-gate negative controls, evidence-chain verification, leakage negative controls, banned phrases, ship blockers, YAML parse, and Action lint: passed.
- npm audit: zero known vulnerabilities at verification time.

The candidate is isolated on branch `fix/credibility-hardening-2026-09-02` in a local commit so
committed-revision proofs can execute. It is not pushed, reviewed, merged, published, or deployed by
this record. Public release identifiers belong here only after the corresponding reviewed artifact
exists; inventing them in advance would defeat the ledger.
