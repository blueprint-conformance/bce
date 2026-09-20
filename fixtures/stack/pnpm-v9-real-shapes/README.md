# pnpm-v9 real shapes

Lockfiles written by pnpm 10.11.1 (`pnpm install --offline`, store-only) for SYNTHETIC workspaces —
`link-only` (two packages whose only dependencies are `workspace:` links to each other) and
`injected` (one link, one empty importer). pnpm writes these with `importers:` alone: no `packages:`
and no `snapshots:` section exists by construction. `link-plus-registry` is the link-only file with
one registry dependency added to the root importer and still no `packages:` — a lost closure, kept
as the negative control. No real repository's content appears here.

Added for the truncation guards (SPEC §16.1), each written by the same pnpm 10.11.1 run and kept
with the `package.json` / `pnpm-workspace.yaml` files its lockfile must cover:

- `mixed` — three packages: two link to each other, the third links to one and depends on one
  registry package, so `packages:` and `snapshots:` exist. Its first 21 lines are byte-identical to
  the `link-only` lockfile: the case the lockfile alone cannot decide.
- `link-workspace-packages` — `.npmrc` `link-workspace-packages=true`: a plain range
  (`specifier: ^1.0.0`) resolved to `version: link:../b`, no `workspace:` specifier anywhere.
- `link-protocol` — `link:`-protocol dependencies on a directory that is not a workspace package
  (and one outside the tree): pnpm writes no importer for either.
- `exclude-links` — `excludeLinksFromLockfile: true`: the declared `link:` dependencies are absent
  from the importer entries, by pnpm's own hand.
- `negated-globs` — `packages/*`, `apps/**` and `!packages/skip`: a directory holding a
  `package.json` that the workspace file takes out again.
- `self-link` — a package depending on ITSELF through `workspace:*`: pnpm writes `version: 'link:'`
  (the lockfile's only self target that is legitimate — under the package's own name).
