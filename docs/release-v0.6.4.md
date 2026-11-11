# `bce-engine@0.6.4` release verification

`bce-engine@0.6.4` was published on `2026-11-11T10:45:26.460Z` from the annotated
`v0.6.4` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release is v0.6.3 plus one security fix. It adds no constraint vocabulary, so `minEngineVersion`
floors are unaffected.

- **Security: symlinked sources under an extraction path refuse**
  ([GHSA-2h5p-pxm5-h89w](https://github.com/blueprint-conformance/bce/security/advisories/GHSA-2h5p-pxm5-h89w),
  [#177](https://github.com/blueprint-conformance/bce/pull/177)). The source walker behind every
  glob-scoped extraction profile never followed symbolic links, as a cycle guard, and skipped trees deeper
  than its bound. Both silently left whatever they reached out of the grade, so a violating file
  behind a symlinked file or directory passed (exit 0). The walker now refuses (exit 2) on a symlinked
  directory, a symlinked file whose path matches the extraction pattern, or an over-deep tree. Links
  the pattern does not select are still ignored. On the reproduction, the published v0.6.4 package
  exits 2 where v0.6.3 exits 0.
- The release workflow signed with `@sigstore/cli` 0.11.0 ([#168](https://github.com/blueprint-conformance/bce/pull/168))
  for the first time; both signatures verify as before.

The immutable archive is a preparation snapshot. Its README, guides and `release-state.json`
still name v0.6.3 as current and v0.6.4 as the candidate. (The Lane-A pin, `.engine-pin.json`, is a
repository file and is not in the archive.) The post-publication activation PR corrects those mutable
install surfaces and the pin; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.6.4`](https://www.npmjs.com/package/bce-engine/v/0.6.4) |
| Published at | `2026-11-11T10:45:26.460Z` |
| npm integrity | `sha512-r2CUTrN7CyUkTaz+93giOVOlnzV5FkJ5WzMbEzgV+zwk/Ziu9w2Q+HhkbFerv1O67DzFkqm75FmFsDFjPAP6Jg==` |
| npm shasum | `a5f00ef4dcfdf79fc31e3eb98d29fb563d52e88d` |
| Source and Action commit | `a3d89e99197a7f0f92267a6f22fad89667272598` |
| Tag | annotated `v0.6.4`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `43003266928`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/43003266928/attempts/1) |
| Canonical and evidence release | [`v0.6.4`](https://github.com/blueprint-conformance/bce/releases/tag/v0.6.4) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.6.4`. The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.6.4`. The annotated Git tag is not claimed as a
cryptographic signature. Before the tag was pushed, a `workflow_dispatch` dry run (run `43001625447`)
passed every release gate on the same commit.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `f558127c56ee92a986d8defc060fff7c69f27e451c3eb454354bce8670dc4083` |
| `release-evidence-record.sigstore` | `e56de9b2355841f9557335e5bae9cd38cc8295d95cf91e30edab843b80a8501e` |
| `release-compliance-report.json` | `b0f16023bc8a4e91296b1a69d7b24914f2db7e76e9c4ea9652a93172518b9ba7` |
| `release-payload-manifest.json` | `47edab380cdf1e8d88f9ba66661a731d2ebf90146254e534df0d62bda197b9e5` |
| `release-payload-manifest.sigstore` | `818ef12b581e8a0ca9a80c81c918a018076c7c85bfdbd6e2e3cef61172b7f55c` |
| `bce-engine-0.6.4.tgz` | `bb0a39ee28c285c9b2b3c4670cc7889c65428bf295502a7697fce180373a47fb` |

The signed payload manifest records `525` package entries and manifest digest
`sha256:8ebaaa8e1096ff939e1576ba74e0668cb582d4a821bbe660f21f317501ca72b2`. Every archive path, size and mode matches that inventory, and the archive's
integrity and shasum match npm. Both Sigstore bundles verify with the lockfile-pinned `@sigstore/cli`
against the GitHub OIDC issuer and the exact tag-workflow identity above, and each signed DSSE payload
is byte-identical to its attached JSON. The EvidenceRecord reports score `100`, verdict `pass` and zero
violations, with record hash `31fcce66e53db39242277a4a6a58fbae0edb6fbe7e413f32f8c515e8ddeb12bb`.

## Exact installed experience

Before publication, the publish job installed the final tarball into a fresh consumer and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on Windows x64, Node v22.19.0 and npm
10.9.3. The registry tarball was byte-identical to the immutable Release asset (SHA-256, SHA-512
integrity and SHA-1 shasum recomputed locally). As `scripts/package-consumer-proof.mjs` does, the
declared-stack predecessor-refusal leg used public `0.4.0`. The bounded summaries are the
[route replay evidence](../evidence/releases/v0.6.4-registry-consumer.json) and the
[declared-stack replay evidence](../evidence/releases/v0.6.4-declared-stack-consumer.json).

On attempt 1, the tag run passed `1,565` tests with `3` skipped, along with the self-gate, every release
gate, provenance publication and immutable Release finalization. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/43001607777) passed
on the source commit. The reviewed PR head and the published squash commit have the same Git tree
(`6d338ce8d8833b6da3dba590b1879393896e2722`).

## Replay and limits

```bash
npm view bce-engine@0.6.4 version dist.integrity dist.shasum dist.attestations
gh release download v0.6.4 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.6.4 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and the exact tag-workflow identity above,
then compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The accepted
RFCs defer repair and reconciliation, and the declared-stack replay's `originAuthenticity` remains
`not-established`.
