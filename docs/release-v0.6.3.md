# `bce-engine@0.6.3` release verification

`bce-engine@0.6.3` was published on `2026-11-10T00:04:27.608Z` from the annotated
`v0.6.3` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release is v0.6.2 plus one security fix and fail-closed corrections. It adds no constraint
vocabulary, so `minEngineVersion` floors are unaffected.

- **Security: pinned runs refuse an incomplete materialized tree**
  ([GHSA-q3v2-5j8r-m3ww](https://github.com/blueprint-conformance/bce/security/advisories/GHSA-q3v2-5j8r-m3ww),
  [#171](https://github.com/blueprint-conformance/bce/pull/171)). Pinned acquisition grades
  `git archive` output, which honours the commit's own `.gitattributes`. So a committed
  `export-ignore` could drop a violating file from the graded tree: v0.6.2 scored such a commit
  100/pass (exit 0) where `--no-pin` failed. `materializeAtRevision` now refuses (exit 2) when any
  tracked file is missing from the extracted tree. On the same reproduction, the published v0.6.3
  package exits 2 where v0.6.2 exits 0.
- **The gate refuses duplicate blueprint identities** ([#156](https://github.com/blueprint-conformance/bce/pull/156)).
  With a committed baseline, a failing blueprint could read its passing twin's empty new-violation
  set and exit 0.
- **Evidence verifiers** ([#158](https://github.com/blueprint-conformance/bce/pull/158),
  [#162](https://github.com/blueprint-conformance/bce/pull/162),
  [#163](https://github.com/blueprint-conformance/bce/pull/163)):
  - the engine chain verifier binds each record id to its hash;
  - the v1 bundle verifier checks the extraction profile and toolchain identity;
  - `tools/verify-chain.mjs` accepts genuine declared-stack records.
- **Package and Action** ([#159](https://github.com/blueprint-conformance/bce/pull/159),
  [#160](https://github.com/blueprint-conformance/bce/pull/160)): the package ships no JS source maps
  or bin-only CJS builds, and the Action builds the local engine once.

The immutable archive is a preparation snapshot. Its README, guides and `release-state.json`
still name v0.6.2 as current and v0.6.3 as the candidate. (The Lane-A pin, `.engine-pin.json`, is a
repository file and is not in the archive.) The post-publication activation PR corrects those mutable
install surfaces and the pin; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.6.3`](https://www.npmjs.com/package/bce-engine/v/0.6.3) |
| Published at | `2026-11-10T00:04:27.608Z` |
| npm integrity | `sha512-oDNXYjuX4/Dui1f5DKf3UgvaZ09TJVfMKdx2Zvz75fdZeTXbjCrMLbKQqMt2SdawsEc6HtBczc3xTetSuUukOg==` |
| npm shasum | `61dacb83a956bae38578a5f085a096fce6a4081c` |
| Source and Action commit | `0e0b022a20e458f77118c5adb210e5e26e5a6e82` |
| Tag | annotated `v0.6.3`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `42723194499`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/42723194499/attempts/1) |
| Canonical and evidence release | [`v0.6.3`](https://github.com/blueprint-conformance/bce/releases/tag/v0.6.3) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.6.3`. The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.6.3`. The annotated Git tag is not claimed as a
cryptographic signature. Before the tag was pushed, a `workflow_dispatch` dry run (run `42721606785`)
passed every release gate on the same commit.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `2cec22879624c8c3e72a1c58c879007ef6f29bd7db88adb7dd6d1003d2d22b85` |
| `release-evidence-record.sigstore` | `0eb3bd3d2247a3d3a9f0ac22de226545e7e3e2e272308b48bea3331c38e3d95a` |
| `release-compliance-report.json` | `2524c6ec27100fbfa3dfd666fc104a84eec6f82bf516f2e78bfeaf72597fcebf` |
| `release-payload-manifest.json` | `bb1d53fb0cfabc8cb45e7bbbbf025bf20c2dc4e37e01dd0151c4aa4050e52f8f` |
| `release-payload-manifest.sigstore` | `16028d70322b3629648a0883fe9a601e10707c1cb25ad6559563e333c932aa99` |
| `bce-engine-0.6.3.tgz` | `f445114df49ef674b1c9c8af542d2ec7b7b2f42f60f689e647d35cf3bdffbcb4` |

The signed payload manifest records `524` package entries and manifest digest
`sha256:9adab2a20a871991065e5a5852b5cbe671747aab357022fbe71a85eac0842c40`. Every archive path, size and mode matches that inventory, and the archive's
integrity and shasum match npm. Both Sigstore bundles verify with the lockfile-pinned `@sigstore/cli`
against the GitHub OIDC issuer and the exact tag-workflow identity above, and each signed DSSE payload
is byte-identical to its attached JSON. The EvidenceRecord reports score `100`, verdict `pass` and zero
violations, with record hash `7859cc936a7f59acec343ee35af4821e11524328e83b0457a22775b65705d1c3`.

## Exact installed experience

Before publication, the publish job installed the final tarball into a fresh consumer and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on Windows x64, Node v22.19.0 and npm
10.9.3. The registry tarball was byte-identical to the immutable Release asset (SHA-256, SHA-512
integrity and SHA-1 shasum recomputed locally). As `scripts/package-consumer-proof.mjs` does, the
declared-stack predecessor-refusal leg used public `0.4.0`. The bounded summaries are the
[route replay evidence](../evidence/releases/v0.6.3-registry-consumer.json) and the
[declared-stack replay evidence](../evidence/releases/v0.6.3-declared-stack-consumer.json).

On attempt 1, the tag run passed `1,563` tests with `3` skipped, along with the self-gate, every release
gate, provenance publication and immutable Release finalization. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/42721555689) passed
on the source commit. The reviewed PR head and the published squash commit have the same Git tree
(`a4ea52d66110a910343ec3789d5fa023a7c8938d`).

## Replay and limits

```bash
npm view bce-engine@0.6.3 version dist.integrity dist.shasum dist.attestations
gh release download v0.6.3 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.6.3 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and the exact tag-workflow identity above,
then compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The accepted
RFCs defer repair and reconciliation, and the declared-stack replay's `originAuthenticity` remains
`not-established`.
