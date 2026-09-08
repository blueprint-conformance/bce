# Live self-adoption

BCE uses its own engine to govern its source repository. The [Home](../README.md) and
[Trust](https://blueprint-conformance.github.io/bce/trust/#self-adoption-status) pages show a
GitHub-backed pipeline for the observed `main` commit, alongside committed authenticated policy.

## Read the pipeline

| Stage | What its GitHub run establishes |
|---|---|
| Source | The exact `main` SHA observed when the status refresh began. |
| Self-gate + doctor | The source engine gates its own tree, doctor checks lifecycle and project readiness, and source mutation proofs exercise the authored constraints. The separate published-engine Lane A must pass too. |
| Tests + evidence | The CI workflow runs its test, evidence and packaged-consumer checks. This is mechanism verification, not a causal efficacy study. |
| Node 22 / 24 | The portability workflow checks both supported runtime versions on macOS, Ubuntu and Windows. |
| Pages deployment | The documentation and schema publisher completed for that same commit. |

These are four selected workflow stages, not an assertion that every repository workflow has
passed. Each stage links to its exact run. All stages are matched to the observed source SHA;
a successful run from an earlier commit cannot fill a missing stage on a newer one. The stages
are a view of verification, not a claim that the workflows execute serially.

A completed success is **Passed**. Queued and active runs are **In progress**. Failed runs are
**Failed**. Cancelled, skipped, missing, unrecognized or incomplete results cannot become green.
A newer run or rerun takes precedence over an older success.

## Freshness and unavailable results

The browser reads GitHub's public REST API on load and every five minutes while the page is
visible. A refresh makes two read-only requests: the `main` commit and its push-triggered workflow
runs. The displayed check time describes that observation; it is not a guarantee that `main`
has not advanced since then. Use **Refresh status** to request a new observation.

Requests use no credentials, token, analytics endpoint, cookies or local storage. GitHub receives
the requests like any public service; its unauthenticated rate limits apply. Network failures,
rate limits, invalid responses and timeouts clear live success and show **Live status unavailable**.
The panel never silently falls back to a green result from another commit or an old local cache.
The ordinary GitHub links and committed policy evidence remain readable without live access or
JavaScript. No polling runs while the tab is hidden.

The static page is deployed by the existing `publish-schemas` workflow. Its small browser module
reads status directly from GitHub, so completed runs appear without another site deployment,
scheduled commit, embedded secret, or separate status service. This observes GitHub; it changes
no repository setting or workflow state.

## What the committed record says

The panel reads `.bce-adoption.json` and the matching authenticated entry in
`.blueprints/POLICY-HISTORY.jsonl` when the site is built. Missing or contradictory presentation
fields refuse the build. The live doctor remains the authority for complete lifecycle readiness.
The committed record and live workflow status are intentionally distinct facts.

The [BCE ceremony evidence](../evidence/self-adoption/README.md) records the real, human-authorized
GitHub decision and source proof. The creator-maintained
[witness ceremony](https://github.com/blueprint-conformance/bce-action-witness/tree/main/evidence/self-adoption)
provides another repository's operational proof; its runs are not part of the main-repository pipeline.

## Honest boundary

The decision is explicitly **self-ratified**. Default team governance still requires a non-author
approving review; see [solo-steward ratification](solo-steward-ratification.md).

These lifecycle additions are implemented in this source and v0.3.1.
The immutable npm `bce-engine@0.3.0` artifact predates them and is unchanged.
First-party operational self-adoption does not establish
independent review, independent replication, external retention, or product efficacy. The primary
240-attempt causal study remains a separate evidence requirement.
