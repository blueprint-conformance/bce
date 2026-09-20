# pnpm-v9 real shapes

Lockfiles written by pnpm 10.11.1 (`pnpm install --offline`, store-only) for SYNTHETIC workspaces —
`link-only` (two packages whose only dependencies are `workspace:` links to each other) and
`injected` (one link, one empty importer). pnpm writes these with `importers:` alone: no `packages:`
and no `snapshots:` section exists by construction. `link-plus-registry` is the link-only file with
one registry dependency added to the root importer and still no `packages:` — a lost closure, kept
as the negative control. No real repository's content appears here.
