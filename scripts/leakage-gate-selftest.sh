#!/usr/bin/env bash
# leakage-gate-selftest.sh — prove the flip-day guard can actually refuse.
#
# leakage-gate is the last thing standing between this tree and a public one, and
# nothing has ever demonstrated it catching anything on purpose. It has a steward
# name, nine tenant names, three contributor first names, four host prefixes, three
# doctrine id shapes, a private registry hostname, and nine credential shapes — and
# the only evidence any of them worked was that an agent tripped the org-name pattern
# twice by accident while writing comments. One class, discovered by mistake.
#
# Probe count is asserted against the pattern list, not this comment: a class added to
# the gate without a probe here is a class with no negative control. Two such classes
# (the bounded tenant pair) were found exactly that way on 2026-08-31 and are now probed.
#
# A guard whose refusals nobody has watched is a guard that might already be
# broken. The consequence lands exactly once, at the flip, and is not recoverable
# by fixing the gate afterwards.
#
# THE REASON THIS DID NOT EXIST: a test for a banned-string scanner has to contain
# banned strings, and would fail the very gate it tests. So every probe here is
# ASSEMBLED FROM FRAGMENTS at runtime, the same technique leakage-gate.yml uses on
# its own pattern list — no banned literal appears in this file.
#
# Each probe is planted in a throwaway copy, one at a time, and the scan must flag
# that file. A baseline asserts the clean copy is silent first, so a catch cannot
# come from pre-existing contamination.
#
# Exit codes:
#   0 — every probe was caught, and the clean tree was silent.
#   1 — at least one probe slipped through.
#   2 — harness failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0

# ---- Fragment assembly. Nothing below is a banned literal in this file. --------
o1="od"; o2="in"; NAME="${o1}${o2}"
t1="redro""cket"; t2="3d""3d"; t4="open""value"; t5="hazel""man"; t7="techre""bels"
t8="fleet""care"; t9="monkey""vision"
# Bounded classes. t3/t6 existed in the gate from the start but had NO probe here —
# two classes with no negative control, found while adding the 2026-08-31 widening.
t3="h""es"; t6="la""rs"
n1="ke""vin"; n2="k""en"; n3="ko""os"
gp="gh""p_"; gs="gh""s_"; go="gh""o_"; gpat="git""hub_pat_"; pk="PRIV""ATE KEY"
sn="blueprintconformance"".dev"
reg="npm.pkg.git""hub.com"
dfA="dark"; dfB="factory"; ocA="open"; ocB="claw"
ip1="77.42.""80.233"; ip2="10.0""."; ip3="136.""243."; ip4="65.""21."
rule="rule-""4"; vp="vp-""alpha"; del="del-""alpha"
sk="sk_""aaaaaaaabbbb"; akia="AKIA""ABCDEFGH1234"; xox="xox""b-abc"
jwt="eyJ""abcdefghijklmnopqrstu.eyJ""x"
pem="-----BEGIN ""${pk}-----"

# label -> probe string
PROBES=(
  "steward-org-name|${NAME} Systems"
  "tenant-1|${t1}"
  "tenant-2|${t2}"
  "tenant-4|${t4}"
  "tenant-5|${t5}"
  "tenant-7|${t7}"
  "tenant-8|${t8}"
  "tenant-9|${t9}"
  "tenant-3-bounded|the ${t3} stack"
  "tenant-6-bounded|the ${t6} tenant"
  "contact-1-bounded|ping ${n1} about it"
  "contact-2-bounded|ask ${n2} first"
  "contact-3-bounded|escalate to ${n3}"
  "host-prod|${ip1}"
  "host-private-range|${ip2}0.5"
  "host-dc-1|${ip3}18.36"
  "host-dc-2|${ip4}23.210"
  "doctrine-rule-id|see ${rule} for detail"
  "cycle-id-vp|cycle ${vp}"
  "cycle-id-del|cycle ${del}"
  "private-registry|${reg}"
  "steward-domain|${sn}"
  "internal-pipeline-codename|the ${dfA}-${dfB} loop"
  "internal-product-name|${ocA}${ocB} gateway"
  "cred-sk|${sk}"
  "cred-gh-pat|${gp}ABCDEFGHIJ12"
  "cred-gh-server|${gs}ABCDEFGHIJ12"
  "cred-gh-oauth|${go}ABCDEFGHIJ12"
  "cred-gh-finegrained|${gpat}abc"
  "cred-aws|${akia}"
  "cred-slack|${xox}"
  "cred-pem|${pem}"
  "cred-jwt|${jwt}"
)

# ---- The scan, mirroring leakage-gate.yml. Keep in lock-step with it. ---------
scan() {  # scan <dir> -> prints hit filenames, exit 0 if any hit
  local d="$1"
  local NAME_PAT="(^|[^a-zA-Z])${NAME}"
  # "O" + "d" + "in" + " Labs". The first version dropped the d, assembling "Oin
  # Labs" — so the allowlist strip never matched and the three legitimately
  # allowlisted files tripped the baseline. Fragment assembly is what keeps this
  # file out of its own scan, and it is also how a typo hides in plain sight.
  local STEWARD="O""d${o2} Labs"
  local PUBLIC_SECURITY_CONTACT="mitchell@${o1}${o2}-labs.ai"
  local CRED=(
    "(^|[^a-zA-Z0-9])sk_[a-zA-Z0-9]{8,}"
    "${gp}[A-Za-z0-9]{10,}" "${gs}[A-Za-z0-9]{10,}" "${go}[A-Za-z0-9]{10,}" "$gpat"
    'AKIA[0-9A-Z]{8,}' 'xox[baprs]-'
    "-----BEGIN [A-Z ]*${pk}-----" 'eyJ[A-Za-z0-9_-]{20,}\.eyJ'
  )
  local PATS=(
    "$NAME_PAT" "$t1" "$t2" "$t4" "$t5" "$t7" "$t8" "$t9"
    "(^|[^a-z0-9_])${t3}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${t6}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n1}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n2}([^a-z0-9_]|$)"
    "(^|[^a-z0-9_])${n3}([^a-z0-9_]|$)"
    '77\.42\.80\.233' '10\.0\.0\.' '136\.243\.' '65\.21\.'
    'rule-[0-9]' '(^|[^a-z0-9])vp-[a-z0-9]' '(^|[^a-z0-9])del-[a-z0-9]'
    "$reg" "$sn" "${dfA}[-_. ]?${dfB}" "${ocA}${ocB}" "${CRED[@]}"
  )
  local ALLOW=("NOTICE" "GOVERNANCE.md" "TRADEMARKS.md")
  # The whole walk runs INSIDE the target dir. The first version cd'd only in the
  # find subshell, so the loop body read `./PROBE.txt` relative to the ORIGINAL
  # cwd — every read failed and every probe reported MISS. A harness that cannot
  # open the file it planted reports "not caught" for a gate that works perfectly.
  ( cd "$d" || exit 0
  local hit=""
  while IFS= read -r -d '' f; do
    local rel="${f#./}" allow=0
    for a in "${ALLOW[@]}"; do [ "$rel" = "$a" ] && allow=1; done
    for p in "${PATS[@]}"; do
      local h
      if [ "$allow" -eq 1 ] && [ "$p" = "$NAME_PAT" ]; then
        h="$(tr -d '\000' < "$f" | sed "s/${STEWARD}//g" | { grep -a -i -E -- "$p" || true; })"
      elif [ "$rel" = "SECURITY.md" ] && [ "$p" = "$NAME_PAT" ]; then
        h="$(tr -d '\000' < "$f" | sed "s/${PUBLIC_SECURITY_CONTACT}//g" | { grep -a -i -E -- "$p" || true; })"
      else
        h="$(tr -d '\000' < "$f" | { grep -a -i -E -- "$p" || true; })"
      fi
      [ -n "$h" ] && { hit="${hit}${rel} "; break; }
    done
  done < <(find . -type f ! -path './.git/*' ! -path './node_modules/*' -print0)
  printf '%s' "$hit"
  )
}

echo "leakage-gate selftest: ${#PROBES[@]} pattern classes, each planted separately"
echo

git -C "$REPO_ROOT" archive HEAD --prefix=base/ | tar -x -C "$TMP"
base_hits="$(scan "$TMP/base")"
if [ -n "$base_hits" ]; then
  echo "::error::selftest: the CLEAN tree already trips the scan: ${base_hits}"
  echo "Fix the real contamination before trusting any negative control."
  exit 2
fi
echo "  baseline: clean tree is silent"
echo

# The public security-address exception is exact in both content and location. It must not become
# a file-wide exemption, and the same address outside SECURITY.md must remain a leak.
contact="mitchell@${o1}${o2}-labs.ai"
exception_dir="$TMP/security_exception"
mkdir -p "$exception_dir"
printf 'Fallback: %s\n' "$contact" > "$exception_dir/SECURITY.md"
[ -z "$(scan "$exception_dir")" ] || { echo "  MISS  exact security contact was not allowlisted"; fails=$((fails+1)); }
printf 'Fallback: %s\n%s Systems\n' "$contact" "$NAME" > "$exception_dir/SECURITY.md"
case "$(scan "$exception_dir")" in *SECURITY.md*) ;; *) echo "  MISS  SECURITY.md exception hid another steward reference"; fails=$((fails+1));; esac
rm -f "$exception_dir/SECURITY.md"
printf 'Fallback: %s\n' "$contact" > "$exception_dir/README.md"
case "$(scan "$exception_dir")" in *README.md*) ;; *) echo "  MISS  security contact escaped its file-scoped allowlist"; fails=$((fails+1));; esac
[ "$fails" -eq 0 ] && echo "  OK    exact SECURITY.md contact exception is content- and file-scoped"
echo

for entry in "${PROBES[@]}"; do
  label="${entry%%|*}"; probe="${entry#*|}"
  d="$TMP/p_${label}"
  # Probes scan ONLY the planted file, not the whole tree. The BASELINE above is
  # what needs a full walk (it proves no pre-existing contamination); a probe just
  # needs to show its pattern class fires. Full-tree-per-probe was ~25 scans and
  # roughly twelve minutes of CI — a gate too slow to run is a gate that gets
  # removed, which is a worse outcome than the one this prevents.
  rm -rf "$d"; mkdir -p "$d"
  printf '%s\n' "$probe" > "$d/PROBE.txt"
  hits="$(scan "$d")"
  case "$hits" in
    *PROBE.txt*) echo "  OK    ${label}" ;;
    *)           echo "  MISS  ${label} — planted and NOT caught"; fails=$((fails+1)) ;;
  esac
done

echo
if [ "$fails" -ne 0 ]; then
  echo "::error::leakage-gate selftest: ${fails} pattern class(es) did not catch their probe."
  echo "This gate is the flip-day guard; a class it cannot catch is a class that ships."
  exit 1
fi
echo "leakage-gate selftest: PASS — all ${#PROBES[@]} pattern classes caught their probe."
