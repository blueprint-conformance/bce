# `bce-engine@0.6.1` release verification

`bce-engine@0.6.1` was published on `2026-11-03T11:36:53.635Z` from the annotated
`v0.6.1` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release adds architecture review across pinned revisions (`bce architecture-review` and
`reviewArchitectureChange`), a policy-impact preview on frozen source (`bce policy-impact`),
evidence-bound repair briefs (`bce repair capture`, `bce repair brief`), honest adoption-attempt
records, workspace-aware stack review (`stack snapshot --workspace-aware`, accepted RFC-0003), the
explicit bounded `forbiddenDependencyPath` arm with `maxHops: 2` (accepted RFC-0004), and an
experimental typed compiler with proof replay for `forbiddenDependency`. It rejects duplicate runtime
observations, verifies installed interfaces, and updates the runtime dependency `brace-expansion` to
5.0.12. Blueprints that use `forbiddenDependencyPath` must declare `minEngineVersion` `0.6.1`; older
engines fail that preflight instead of skipping the arm. The native Zod 4 schemas from v0.6.0 and the
declared-stack contract from v0.5.0 are retained.

The immutable archive is a preparation snapshot: its README, guides, and `release-state.json`
still name v0.6.0 as current and v0.6.1 as the candidate (the Lane-A pin, `.engine-pin.json`, is a
repository file and is not in the archive). Those mutable install surfaces and the pin are corrected
by the post-publication activation PR; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.6.1`](https://www.npmjs.com/package/bce-engine/v/0.6.1) |
| Published at | `2026-11-03T11:36:53.635Z` |
| npm integrity | `sha512-s2aUWpWiQPmb7pw7ruWAiE+TwodOTD+EFQIsI26hKAeOn0pv4LrGCSJY+xQWuNbYYDWQwMGNhVMQVsChWn0Reg==` |
| npm shasum | `3d07c8c98bd96824375319542811d45fb58f13e4` |
| Source and Action commit | `ef5b806dcf58b1100db9ca512c6f7683d3873697` |
| Tag | annotated `v0.6.1`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `41624279604`, attempt `2`](https://github.com/blueprint-conformance/bce/actions/runs/41624279604/attempts/2) |
| Canonical and evidence release | [`v0.6.1`](https://github.com/blueprint-conformance/bce/releases/tag/v0.6.1) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.6.1`. The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.6.1`. The annotated Git tag is not claimed as a
cryptographic signature.

Attempt 1 of the tag run passed the release gate and failed at the publish job's keyless
sign-and-verify step, before any npm publication or GitHub Release. Attempt 2 re-ran the same tag
and commit, passed every job, published, and finalized the immutable Release; npm provenance names
attempt 2.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `d11150dbb45098d61ae26d7523217ed24348b21c8a81cab7d5279092bc7f1038` |
| `release-evidence-record.sigstore` | `a5ac41061e810d038089eb75ea37f6a2f36b4d9807c2f9d76a3d1c431c01ca0a` |
| `release-compliance-report.json` | `9ba909fec6b4021acb882d6df470a526207fa7e9a16a66eb28157be8602a50f3` |
| `release-payload-manifest.json` | `af8836e72f7c26640efe2dc60e28f01fe3b998c59567a01fe8c097893f9d0008` |
| `release-payload-manifest.sigstore` | `aba2dd7c3338a2690e04e71f7ebca91dc9910cc8a3bbd7b0bd0fd16ccb16315a` |
| `bce-engine-0.6.1.tgz` | `d4ccf5e699b213ff9a26025f1f618be26a098e24dcd5c7be6d6d97ec66b4d687` |

The signed payload manifest records `528` package entries and manifest digest
`sha256:2873ea1b0f1a9f3f21612eef1876c22db11241e8c8266c08b2e3caf21c333485`; every archive path,
size, and mode matches that inventory. Its archive integrity and shasum match npm. Both Sigstore
bundles verify with the lockfile-pinned `@sigstore/cli` against the GitHub OIDC issuer and the exact
tag-workflow identity above, and each signed DSSE payload is byte-identical to its attached JSON. The
EvidenceRecord reports score `100`, verdict `pass`, zero violations, and record hash
`1935825344b1016875831db1d45997b3a5a2a3a8b271aa18ca55411eb82a3854`.

## Exact installed experience

The publish job installed the final tarball into a fresh consumer before publication and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on Windows x64, Node v22.19.0, and npm
10.9.3. The registry tarball was byte-identical to the immutable Release asset (SHA-256, SHA-512
integrity, and SHA-1 shasum recomputed locally). The declared-stack predecessor-refusal leg used
public `0.4.0`, the newest public engine below the declared-stack `minEngineVersion` floor of
`0.5.0`, as `scripts/package-consumer-proof.mjs` does. The bounded summaries are
[route replay evidence](../evidence/releases/v0.6.1-registry-consumer.json) and
[declared-stack replay evidence](../evidence/releases/v0.6.1-declared-stack-consumer.json).

The declared-stack replay was run through `npm exec`. Run directly with `node` on Windows, its first
`run --emit-bundle` case refuses with exit 2 because the engine's npm-version probe cannot spawn
`npm.cmd` without a shell. The refusal is fail-closed (no case passes that should not), and it is a
Windows portability defect in evidence emission, not a declared-stack result.

The tag run passed `1,540` tests with `2` skipped, the self-gate, every release gate, provenance
publication, and immutable Release finalization on attempt 2. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/41581400162) passed
on the source commit. The reviewed PR head and the published squash commit have the same Git tree
(`cfd9dc7ba3785f09ed0d9fb06698cdae38810ab9`).

## Replay and limits

```bash
npm view bce-engine@0.6.1 version dist.integrity dist.shasum dist.attestations
gh release download v0.6.1 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.6.1 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and exact tag-workflow identity above,
and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The accepted
RFCs defer repair and reconciliation, and the declared-stack replay's `originAuthenticity` remains
`not-established`.
