# bce pre-commit hook

[`bce-gate.sh`](./bce-gate.sh) runs the blueprint-conformance gate over the **staged tree** before
every commit and passes the gate's exit code through unmodified — a red gate blocks the commit.

## What it does (exactly)

1. Collects the staged files (`git diff --cached --name-only --diff-filter=ACMR`). If nothing is
   staged, it exits 0 without invoking the engine.
2. Materializes the staged index into a temp dir (`git checkout-index -a`), so the gate grades
   **what is about to be committed**, not unstaged working-tree edits.
3. Runs `bce gate --repo <staged-tree> --changed <staged-files>` and exits with the gate's code.

No skip flag is added here. Advisory posture is a committed `.bce-mode.json` mode the engine reads
on its own; `git commit --no-verify` remains git's own escape hatch, unchanged.

## Install

From your repository root, either copy it in place:

```sh
cp node_modules/bce-engine/integrations/pre-commit/bce-gate.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

or keep hooks in-repo with `core.hooksPath`:

```sh
mkdir -p .githooks
cp node_modules/bce-engine/integrations/pre-commit/bce-gate.sh .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

For the [pre-commit framework](https://pre-commit.com), wrap it as a local hook:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: bce-gate
        name: bce blueprint-conformance gate
        entry: sh node_modules/bce-engine/integrations/pre-commit/bce-gate.sh
        language: system
        pass_filenames: false
```

## Environment overrides

| Variable | Effect | Default |
|----------|--------|---------|
| `BCE_BIN` | Command used to invoke the CLI (may contain arguments) | `node_modules/.bin/bce` |
| `BCE_REPO_DIR` | **Direct mode**: gate this directory as-is (full sweep), skipping the git staged-tree step — usable outside a git repo | unset |
| `BCE_BLUEPRINT_DIR` | Blueprint discovery directory (`--blueprint-dir`) | engine default (`<repo>/.blueprints`) |
| `BCE_EXTRACTOR` | Extractor kind, `ast` or `line-scan` | `ast` |

## Proven, not just documented

The hook is executed by the test suite (`tests/pre-commit-hook.test.ts`) in both modes:

- **Direct mode** against the repo's own fixture trees — the conformant tree exits 0, the
  seeded-drift tree exits 1 (exit-code passthrough, both directions).
- **Git mode** against a scratch git repository — a staged violation blocks, a staged conformant
  tree passes, an unstaged violation does NOT leak into the graded tree, and an empty index
  exits 0 without invoking the engine.
