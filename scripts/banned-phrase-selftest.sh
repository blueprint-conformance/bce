#!/usr/bin/env bash
# banned-phrase-selftest.sh — prove the positioning-honesty gate can refuse.
#
# banned-phrase-gate sweeps the tree for nine self-aggrandizing phrases and fails
# on any hit. Nothing has ever demonstrated it catching one. It is a small gate,
# which is exactly why it is worth a control: a `grep -F` list is the kind of thing
# that keeps reporting "clean (9 patterns, 0 hits)" long after a typo, a stray
# quote, or an exclusion has made one of the entries unmatchable. The output looks
# identical either way.
#
# THE CONSTRUCTION PROBLEM: the gate must name the phrases in order to ban them,
# so it excludes its own file. A self-test that spelled them out would need a
# SECOND exclusion — and an excluded file is a file that is never scanned, which
# is a hole in the very guard being tested. So every probe here is assembled from
# fragments at runtime and no banned phrase appears literally in this file.
#
# Each probe is planted alone in a throwaway dir and the sweep must flag it. A
# baseline asserts the committed tree is clean first, so a catch cannot be
# inherited from pre-existing contamination.
#
# Exit codes:
#   0 — every phrase caught its probe, and the tree is clean.
#   1 — at least one phrase did not catch its probe.
#   2 — harness failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0

# ---- Fragment assembly. No banned phrase appears literally in this file. ------
a1="Angular"" for AI"
a2="the ""definitive"
a3="the ""standard for"
a4="industry ""standard"
a5="world""'s first"
a6="first""-ever"
a7="the first ""and only"
a8="best""-in-class"
a9="revolution""ary"

PHRASES=("$a1" "$a2" "$a3" "$a4" "$a5" "$a6" "$a7" "$a8" "$a9")
# Labels must not SPELL the phrases they name. The first version used
# kebab-case labels, three of which were byte-identical to banned phrases —
# so this file would have tripped the real gate on merge. It was hidden
# because the sweep below excluded this file, which is the same
# never-scanned-hole the gate's own exclusion creates. The exclusion is gone
# and the labels are de-literalised.
LABELS=(angular-for-ai definitive standard-for industry-standard worlds-first firstever first-and-only bestinclass grandiose)

# ---- The sweep, mirroring banned-phrase-gate.yml. Keep in lock-step. ---------
sweep() {  # sweep <dir> -> prints matching relative paths
  local d="$1" out=""
  local p
  for p in "${PHRASES[@]}"; do
    local h
    h="$(grep -rniF --binary-files=without-match \
          --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
          --exclude='banned-phrase-gate.yml' \
          -- "$p" "$d" 2>/dev/null || true)"
    [ -n "$h" ] && out="${out}${p}|"
  done
  printf '%s' "$out"
}

echo "banned-phrase selftest: ${#PHRASES[@]} phrases, each planted separately"
echo

git -C "$REPO_ROOT" archive HEAD --prefix=base/ | tar -x -C "$TMP"
base="$(sweep "$TMP/base")"
if [ -n "$base" ]; then
  echo "::error::selftest: the committed tree already contains banned phrasing: ${base}"
  echo "Fix the real contamination before trusting any negative control."
  exit 2
fi
echo "  baseline: committed tree is clean"
echo

i=0
while [ $i -lt ${#PHRASES[@]} ]; do
  d="$TMP/probe_$i"; rm -rf "$d"; mkdir -p "$d"
  printf 'This project is %s in its field.\n' "${PHRASES[$i]}" > "$d/PROBE.md"
  hits="$(sweep "$d")"
  case "$hits" in
    *"${PHRASES[$i]}"*) echo "  OK    ${LABELS[$i]}" ;;
    *) echo "  MISS  ${LABELS[$i]} — planted and NOT caught"; fails=$((fails+1)) ;;
  esac
  i=$((i+1))
done

echo
if [ "$fails" -ne 0 ]; then
  echo "::error::banned-phrase selftest: ${fails} phrase(s) did not catch their probe."
  echo "A phrase the sweep cannot match is one that ships while the gate reports clean."
  exit 1
fi
echo "banned-phrase selftest: PASS — all ${#PHRASES[@]} phrases caught their probe."
