#!/bin/sh
# bce-gate.sh — git pre-commit hook: run the bce blueprint-conformance gate over the STAGED tree.
#
# The gate's exit code is passed through UNMODIFIED (fail-closed): a red gate blocks the commit,
# a green gate lets it through. There is no skip flag here — advisory posture is a COMMITTED
# `.bce-mode.json` mode the engine reads on its own. (`git commit --no-verify` remains git's own
# escape hatch; this hook adds none of its own.)
#
# What runs, exactly (default git mode):
#   1. Collect the staged files (`git diff --cached --name-only --diff-filter=ACMR`).
#      Nothing staged → exit 0 without invoking the engine.
#   2. Materialize the STAGED tree (`git checkout-index -a`) into a temp dir, so the gate grades
#      exactly what is about to be committed — NOT unstaged working-tree edits.
#   3. Run `bce gate --repo <staged-tree> --changed <staged-files>` and exit with its code.
#      Blueprints are discovered at the engine default (<staged-tree>/.blueprints) unless
#      BCE_BLUEPRINT_DIR overrides it.
#
# Environment overrides (all optional; every one is honored in both modes):
#   BCE_BIN            Command used to invoke the CLI. Default: "npx bce" (works when bce-engine
#                      is a devDependency). May contain arguments, e.g.
#                      BCE_BIN="node --import tsx /path/to/bce/src/cli.ts"
#   BCE_REPO_DIR       DIRECT MODE: gate this directory as-is (full sweep) and skip the git
#                      staged-tree materialization entirely. This is how the hook's own test
#                      suite proves it against fixture trees, and how you can smoke-test the
#                      hook outside a git repo.
#   BCE_BLUEPRINT_DIR  Blueprint discovery directory (passed as --blueprint-dir).
#   BCE_EXTRACTOR      Extractor kind, ast | line-scan. Default: ast.
#
# Install (from your repo root):
#   cp <this-file> .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# or with core.hooksPath / a hook manager — see integrations/pre-commit/README.md.

set -eu

BCE_BIN="${BCE_BIN:-npx bce}"
BCE_EXTRACTOR="${BCE_EXTRACTOR:-ast}"

# ── DIRECT MODE: BCE_REPO_DIR set → gate that tree as-is (full sweep), no git required ─────────
if [ -n "${BCE_REPO_DIR:-}" ]; then
  set -- gate --repo "$BCE_REPO_DIR" --extractor "$BCE_EXTRACTOR"
  if [ -n "${BCE_BLUEPRINT_DIR:-}" ]; then
    set -- "$@" --blueprint-dir "$BCE_BLUEPRINT_DIR"
  fi
  # exec = exit-code passthrough by construction. Word-splitting of BCE_BIN is deliberate.
  # shellcheck disable=SC2086
  exec $BCE_BIN "$@"
fi

# ── GIT MODE (the actual pre-commit path): gate the staged tree ─────────────────────────────────
GIT_TOP="$(git rev-parse --show-toplevel)"

STAGED="$(git -C "$GIT_TOP" diff --cached --name-only --diff-filter=ACMR)"
if [ -z "$STAGED" ]; then
  # Nothing staged (e.g. a deletion-only or empty commit) — nothing to gate.
  exit 0
fi

# Materialize the staged index into a temp dir so unstaged edits are NOT graded.
STAGED_TREE="$(mktemp -d "${TMPDIR:-/tmp}/bce-precommit.XXXXXX")"
trap 'rm -rf "$STAGED_TREE"' EXIT
git -C "$GIT_TOP" checkout-index -a --prefix="$STAGED_TREE/"

CHANGED="$(printf '%s\n' "$STAGED" | tr '\n' ',')"

set -- gate --repo "$STAGED_TREE" --changed "$CHANGED" --extractor "$BCE_EXTRACTOR"
if [ -n "${BCE_BLUEPRINT_DIR:-}" ]; then
  set -- "$@" --blueprint-dir "$BCE_BLUEPRINT_DIR"
fi

rc=0
# shellcheck disable=SC2086
$BCE_BIN "$@" || rc=$?
exit "$rc"
