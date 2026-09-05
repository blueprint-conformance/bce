#!/usr/bin/env bash
# One dependency-free leakage scan for pull requests, release rehearsals, and tags.
#
# Pass the tree to scan as the first argument (default: current directory). The
# patterns are assembled from fragments so this script remains inside its own
# scan surface without embedding a banned literal.
set -euo pipefail

SCAN_ROOT="${1:-.}"
if [ ! -d "$SCAN_ROOT" ]; then
  echo "leakage-gate: FAIL — scan root is not a directory: ${SCAN_ROOT}" >&2
  exit 2
fi

(
  cd "$SCAN_ROOT"

  o1="od"; o2="in"; c1="O"
  NAME="${o1}${o2}"
  NAME_PAT="(^|[^a-zA-Z])${NAME}"
  STEWARD="${c1}d${o2} Labs"
  PUBLIC_SECURITY_CONTACT="mitchell@${o1}${o2}-labs.ai"

  sn="blueprintconformance"".dev"
  dfA="dark"; dfB="factory"
  ocA="open"; ocB="claw"

  t1="redro""cket"
  t2="3d""3d"
  t3="h""es"
  t4="open""value"
  t5="hazel""man"
  t6="la""rs"
  t7="techre""bels"
  t8="fleet""care"
  t9="monkey""vision"
  n1="ke""vin"; n2="k""en"; n3="ko""os"

  gp="gh""p_"; gs="gh""s_"; go="gh""o_"; gpat="git""hub_pat_"
  pk="PRIV""ATE KEY"
  CRED_PATTERNS=(
    "(^|[^a-zA-Z0-9])sk_[a-zA-Z0-9]{8,}"
    "${gp}[A-Za-z0-9]{10,}"
    "${gs}[A-Za-z0-9]{10,}"
    "${go}[A-Za-z0-9]{10,}"
    "$gpat"
    'AKIA[0-9A-Z]{8,}'
    'xox[baprs]-'
    "-----BEGIN [A-Z ]*${pk}-----"
    'eyJ[A-Za-z0-9_-]{20,}\.eyJ'
  )

  PATTERNS=(
    "$NAME_PAT"
    "$t1"
    "(^|[^a-z0-9_])${t2}([^a-z0-9_]|$)"
    "$t4"
    "$t5"
    "$t7"
    "$t8"
    "$t9"
    "(^|[^a-z0-9_])${t3}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${t6}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n1}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n2}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n3}([^a-z0-9_]|$)"
    '77\.42\.80\.233'
    '10\.0\.0\.'
    '136\.243\.'
    '65\.21\.'
    'rule-[0-9]'
    '(^|[^a-z0-9])vp-[a-z0-9]'
    '(^|[^a-z0-9])del-[a-z0-9]'
    'npm\.pkg\.git''hub\.com'
    "$sn"
    "${dfA}[-_. ]?${dfB}"
    "${ocA}${ocB}"
    "${CRED_PATTERNS[@]}"
  )

  # These files may contain only the exact public steward attribution. Every
  # other byte in them remains subject to every pattern.
  STEWARD_ALLOWLIST=("NOTICE" "GOVERNANCE.md" "TRADEMARKS.md")

  # Immutable public-pilot evidence has four reviewed collisions. An exception
  # is accepted only for an exact path+digest pair; changing one byte restores
  # the normal scan.
  PINNED_EVIDENCE=(
    "research/model-evaluation/pilots/accelerated-v1/artifacts/tasks/boundary-feature/functional-oracle.mjs|ab488713fce71d6272d0d2c1eaf42d0c750ad5873b28122868229db97a9cf1ef"
    "research/model-evaluation/pilots/accelerated-v2/artifacts/tasks/boundary-feature/functional-oracle.mjs|ab488713fce71d6272d0d2c1eaf42d0c750ad5873b28122868229db97a9cf1ef"
    "research/model-evaluation/pilots/accelerated-v3/artifacts/tasks/boundary-feature/functional-oracle.mjs|ab488713fce71d6272d0d2c1eaf42d0c750ad5873b28122868229db97a9cf1ef"
    "research/model-evaluation/pilots/accelerated-v3/artifacts/bce-treatment-runtime-v3.tgz|db2a215679f89bdb76cce65f88e88b529a799ec2b880487315d908c78576d4e7"
  )

  sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$1" | awk '{print $1}'
    else
      shasum -a 256 "$1" | awk '{print $1}'
    fi
  }

  pinned_evidence() {
    local rel="$1" file="$2" entry
    for entry in "${PINNED_EVIDENCE[@]}"; do
      [ "$rel" = "${entry%%|*}" ] || continue
      [ "$(sha256_file "$file")" = "${entry#*|}" ] && return 0
      return 1
    done
    return 1
  }

  fail=0
  while IFS= read -r -d '' f; do
    rel="${f#./}"
    if pinned_evidence "$rel" "$f"; then continue; fi

    allow=0
    for a in "${STEWARD_ALLOWLIST[@]}"; do
      if [ "$rel" = "$a" ]; then allow=1; fi
    done

    for p in "${PATTERNS[@]}"; do
      if [ "$allow" -eq 1 ] && [ "$p" = "$NAME_PAT" ]; then
        hits="$(LC_ALL=C tr -d '\000' < "$f" | sed "s/${STEWARD}//g" | { grep -a -i -n -E -- "$p" || true; })"
      elif [ "$rel" = "SECURITY.md" ] && [ "$p" = "$NAME_PAT" ]; then
        hits="$(LC_ALL=C tr -d '\000' < "$f" | sed "s/${PUBLIC_SECURITY_CONTACT}//g" | { grep -a -i -n -E -- "$p" || true; })"
      else
        hits="$(LC_ALL=C tr -d '\000' < "$f" | { grep -a -i -n -E -- "$p" || true; })"
      fi
      if [ -n "$hits" ]; then
        echo "LEAKAGE HIT in ${rel} (pattern: ${p}):"
        echo "$hits" | head -20
        fail=1
      fi
    done
  # node_modules is lockfile-restored third-party code and is outside both the
  # repository and npm package surfaces. Excluding it keeps checkout and release
  # scans identical; all first-party and shipped paths remain covered.
  done < <(find . -type f ! -path './.git/*' ! -path './node_modules/*' -print0)

  if [ "$fail" -ne 0 ]; then
    echo "leakage-gate: FAIL — banned strings found (see hits above)."
    exit 1
  fi
  echo "leakage-gate: PASS — no banned strings found."
)
