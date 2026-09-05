# `bce-engine@0.2.0` release verification

`bce-engine@0.2.0` was published on 2026-09-05 through the tag-gated release workflow. This page
binds the registry artifact, source, provenance, and recovered release evidence without hiding the
asset-ordering failure that occurred after npm publication.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.2.0`](https://www.npmjs.com/package/bce-engine/v/0.2.0) |
| Published at | `2026-09-05T03:14:26.993Z` |
| npm integrity | `sha512-hFKOHO+EYgQbp+jaOW7/WTBGEqjHDEEKfB+O1ALo8KLnmIAr708mQWeXxRUMi3YAmWxz1RhfiAY1Rdpk81NNrA==` |
| npm shasum | `a137546b6fc8d90b103b78269b218a77870aace4` |
| Source and Action commit | `14716bf655d8dd6020b9dcf8905678ef2abe2760` |
| Tag | annotated `v0.2.0`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run 33940706575, attempt 2](https://github.com/blueprint-conformance/bce/actions/runs/33940706575/attempts/2) |
| Canonical release | [`v0.2.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.2.0) — immutable |
| Evidence release | [`evidence-v0.2.0`](https://github.com/blueprint-conformance/bce/releases/tag/evidence-v0.2.0) — immutable, same source commit |

The npm provenance subject is `pkg:npm/bce-engine@0.2.0`. It binds the package digest to
`.github/workflows/release.yml@refs/tags/v0.2.0`, the Git commit above, and attempt 2 of the linked
GitHub Actions run. The annotated Git tag is not claimed as a cryptographic signature; npm
provenance and the Sigstore evidence bundle are the authenticated producer evidence.

## Evidence assets

The supplemental immutable release contains exactly these recovered assets:

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `2d44521cfdc9bca4d3063051fe12c464d776d4f7035b40e559689f184e931f3f` |
| `release-evidence-record.sigstore` | `ae7ce3edadd11a3cff02b48ff5e25301772a619cf9f278cd82ff296b0a8a930a` |
| `release-compliance-report.json` | `aaa58b6ad9fd5afd93e20fd3da0fc4a2c57fa35c2eba944890c08428c762d227` |

The bundle was reconstructed from public Rekor entry
[`108e9186e8c5677a2a4ca6bb093fd4f840ee998feb75da9566762f5db8b73eebbf8a95abd5de72d3`](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a2a4ca6bb093fd4f840ee998feb75da9566762f5db8b73eebbf8a95abd5de72d3)
and verified against both constraints used in the release workflow:

- certificate issuer: `https://token.actions.githubusercontent.com`;
- certificate identity: `https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.2.0`.

## Incident and fix-forward

The first publish attempt stopped before npm publication when the Sigstore client timed out while
submitting to Rekor. The failed job was retried against the same already-pushed annotated tag and
exact source commit. Attempt 2 generated and verified the evidence again, then published the npm
package with provenance.

The old workflow next created the canonical GitHub Release as published. Repository immutability
froze it immediately, so the following asset upload was rejected with HTTP 422. The canonical
release is therefore immutable and intentionally has no assets. The package and `v0.2.0` tag were
not moved, deleted, or republished. Instead, the exact record retained in the run log, its
Rekor-recovered bundle, and the deterministically regenerated compliance report were attached to
the supplemental immutable evidence release at the same source commit.

[PR #51](https://github.com/blueprint-conformance/bce/pull/51) fixes future ceremonies: it stages
and digest-checks every asset on a draft, publishes npm, then freezes the prepared GitHub Release in
a separate retry-safe finalizer. [GitHub's immutable-release documentation](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
likewise requires assets to be uploaded before a draft is published.

## Independent replay

Registry identity can be checked without trusting this page:

```bash
npm view bce-engine@0.2.0 version dist.integrity dist.shasum dist.attestations
npm pack bce-engine@0.2.0
printf 'sha512-%s\n' "$(openssl dgst -sha512 -binary bce-engine-0.2.0.tgz | openssl base64 -A)"
shasum -a 1 bce-engine-0.2.0.tgz
```

After downloading the three evidence assets from the supplemental release, compare their SHA-256
values with the table and verify the bundle from a clean source checkout:

```bash
gh release download evidence-v0.2.0 --repo blueprint-conformance/bce
shasum -a 256 release-evidence-record.json release-evidence-record.sigstore release-compliance-report.json
npm ci
node node_modules/@sigstore/cli/bin/run verify \
  release-evidence-record.sigstore \
  --certificate-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-uri https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.2.0
```

This is release-supply-chain and deterministic-mechanism evidence. It is not independent adoption,
private-product dogfood, or efficacy evidence, and it does not enter the sealed comparative-study
outcome ledger.
