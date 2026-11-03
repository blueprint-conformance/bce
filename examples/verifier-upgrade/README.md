# Qualify a verifier change on a frozen fixture

This example compares observations produced independently by two **explicitly admitted first-party
BCE artifacts**. It is a recipe built on `bce run --emit-bundle`, not an upgrade command, package
execution service, hostile-code sandbox, or compatibility certification.

The included TypeScript module fixture deliberately violates a direct dependency rule. Equivalent
results therefore mean “the same observed failure,” not “the project conforms.” The recipe accepts
only schema-1 TypeScript AST module evidence, `packages/**/*.ts`, one unqualified required
`staticAst` evidence requirement, and regular tracked `policy.json`/TypeScript fixture files. It
refuses other profiles, configuration files, symlinks and submodules. Extend the experiment through
reviewed examples before making broader claims.

## 1. Admit and install exact artifacts separately

Use Node 22 and Git. Obtain exact first-party tarballs through the project's release verification
process. Check the recorded source commit, immutable release metadata, tarball digest and npm
integrity; verify the producer signature with the release's expected identity when claiming
cryptographic provenance. For a source build, check out the exact reviewed commit, install with
`npm ci --ignore-scripts`, then explicitly build and pack with `npm pack --ignore-scripts`.
Label it a source build, not a registry release.

Install each already-verified local tarball into its own empty consumer directory:

```sh
npm install --prefix /absolute/base-consumer --ignore-scripts --no-audit --no-fund \
  --save-exact /absolute/artifacts/base.tgz
npm install --prefix /absolute/candidate-consumer --ignore-scripts --no-audit --no-fund \
  --save-exact /absolute/artifacts/candidate.tgz
```

Installation may fetch declared dependencies; it is separate from capture. The recipe never
selects versions, downloads packages, runs installation hooks, or uses `npx`. A tarball hash and
an editable JSON record identify bytes; they do not establish who produced them or grant trust.
Only execute an artifact after checking its first-party provenance outside this helper.

Set `RECIPE` to this installed `examples/verifier-upgrade` directory. Inspect the installed bytes
without importing or executing the engine:

```sh
node "$RECIPE/capture.mjs" identify /absolute/base-consumer/node_modules/bce-engine \
  /absolute/artifacts/base.tgz > base.identity.json
node "$RECIPE/capture.mjs" identify /absolute/candidate-consumer/node_modules/bce-engine \
  /absolute/artifacts/candidate.tgz > candidate.identity.json
```

Review both records and add a `provenance` string describing the actual external checks and their
source references. Keep these records unchanged alongside the evidence. This is a local record of
your admission decision, not an authenticated assertion that the helper verifies. The helper
requires package name `bce-engine` and exact tarball, installed distribution, dependency lock/tree,
and host runtime identities before execution. Different bytes remain different identities even
when the package version is identical.

## 2. Freeze the fixture once; capture each verifier independently

Copy the included `fixture/` directory into a new directory outside either installation. Initialize
it as a repository and commit `policy.json` and `packages/` using your normal Git identity. Set
`FIXTURE` to its absolute path and `REVISION` to the full 40-character commit SHA. Do not add a
configuration file or install dependencies in this fixture. The capture output directories must
not exist and must sit outside the fixture and the engine package.

```sh
node "$RECIPE/capture.mjs" capture base.identity.json "$FIXTURE" "$REVISION" /absolute/base-capture
node "$RECIPE/capture.mjs" capture candidate.identity.json "$FIXTURE" "$REVISION" /absolute/candidate-capture
```

Each command copies the canonical commit/tree/blob objects into a fresh hook-free repository,
verifying each object ID. It copies no local configuration, attributes or hooks and performs no
clone, fetch or checkout. That installed artifact's CLI independently materializes and extracts
this isolated immutable commit, including when an older verifier has weaker archive controls. Policy content is read from the committed `policy.json`, parsed, and serialized as canonical
JSON for the verifier. The receipt retains both the committed-byte hash and canonical policy digest;
uncommitted policy edits are not inputs. No prebuilt graph is shared. Capture retains raw `report.json`, `bundle.json`, and the
process/configuration stdout, stderr, exit and signal in `capture.json`, together with before/after
pinned source-object and artifact inventories and resolved acquisition settings. Output is created exclusively;
a capture never overwrites a previous attempt.

Each child process has a 60-second limit and a combined 1-MiB stdout/stderr limit. On exceeding
either, the process group is terminated on POSIX, or `taskkill /T` is used on Windows. Capture uses
a neutral working directory, disables Git replacement objects and global/system attributes, and removes inherited
`NODE_OPTIONS`, `NODE_PATH`, `TAR_OPTIONS` and Git override variables. Git configuration and global
attributes use a temporary regular empty file, cleaned after the operation. These are bounded execution controls, not
resource isolation or protection from malicious admitted code. Capture executes trusted code on
your host; do not use it to inspect an unknown package safely.

A capture command returning 0 means the bounded attempt was recorded. It does **not** mean the
verifier passed, produced complete evidence, or is safe to upgrade. Inspect comparison next.

## 3. Compare data without running either engine

```sh
node "$RECIPE/compare.mjs" /absolute/base-capture /absolute/candidate-capture \
  base.identity.json candidate.identity.json > comparison.json
```

The comparator imports neither verifier and executes no package code. It checks bundle hashes,
raw-report agreement, exact source/policy/acquisition/runtime identity, process completion and
complete expected module coverage. It compares the whole report, graph, coverage, components and
dependencies, retaining differences in identifiers, anchors, messages, scores and verdicts.

| Status | Exit | Meaning |
|---|---:|---|
| `equivalent-observations` | 0 | Complete captures agree within this fixture envelope. |
| `changed-observations` | 1 | Complete captures differ; inspect both raw artifacts before deciding why. |
| `incomparable` | 2 | A capture is missing, malformed, refused, altered or outside the supported envelope. |

A removed finding is not automatically an improvement. A missing module cannot disappear behind
an unchanged verdict or file count. Unsupported schema/profile, changed acquisition, unresolved
imports, timeout, crash and missing output never become “unchanged.” Local capture records and
bundle hashes remain integrity evidence, not origin authentication.
Schema-1 producers may omit an empty unresolved-import list. A present list must be an array;
null, other malformed values, and any nonempty unresolved-import list make the captures incomparable.

Do **not** validate the old report by calling the candidate's `verifyEvidenceBundle`: that API
re-evaluates the old graph with the current evaluator, so an intentional evaluator change could
appear to invalidate a legitimate old result. This comparator checks structure and hashes without
replaying either report. Optional reproduction must use each original admitted artifact separately.

## What was actually exercised

A released `bce-engine@0.6.0` artifact and a source build of reviewed commit
`dda96a294bafdf75409ba359f5b0688b5764a3fd` (`0.6.1`) produced equivalent observations on the direct
module fixture. The released tarball SHA-256 was
`00402da4120288abd6d97557bc643d40facad3b86fcc727fc5ec452cb0a6780a`. The experiment matched recorded
release/npm hashes and provenance workflow metadata; it did not independently verify a Sigstore
signature or supply an independent human witness.

A second, identical-on-both-sides policy using the new bounded dependency-path vocabulary exposed
an actual capability difference: 0.6.0 refused schema validation without producing a bundle, while
the source-built candidate produced a complete violation report. **Both processes exited 1.** This
is incomplete qualification (`incomparable`), never equivalent observations. A version string or
exit code alone cannot establish compatibility.

The installed example's offline proof captures the fixture twice and exercises changed historical
diagnostics without current-engine replay, lost inventory, altered identities, malformed/missing
output, incompatible evidence, moving revisions, output overwrite refusal, and actual
crash/timeout/output-limit controls. It also invokes both CLI entry points through a directory
symlink (a junction on Windows), checks their JSON output, and verifies that importing either
module does not execute its CLI:

```sh
node "$RECIPE/proof.mjs" /absolute/admitted-consumer/node_modules/bce-engine /absolute/admitted.tgz
```

This proof executes the explicitly supplied admitted artifact. It tests the example mechanics,
not arbitrary source compatibility, a historical same-version artifact pair, or automatic upgrade
approval. Keep raw captures for the particular verifier pair and source/policy you actually assessed.
