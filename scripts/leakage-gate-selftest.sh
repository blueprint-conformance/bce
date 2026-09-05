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
# ASSEMBLED FROM FRAGMENTS at runtime, the same technique leakage-scan.sh uses —
# no banned literal appears in this file.
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

# ---- Exercise the exact production scanner. ------------------------------------
SCANNER="$REPO_ROOT/scripts/leakage-scan.sh"
scan() {
  bash "$SCANNER" "$1"
}

# Both enforcement contexts must call the same implementation exactly once.
# This prevents the release copy from becoming weaker, broader, or simply stale.
for workflow in \
  "$REPO_ROOT/.github/workflows/leakage-gate.yml" \
  "$REPO_ROOT/.github/workflows/release.yml"; do
  consumer_count="$(grep -c '^        run: bash scripts/leakage-scan\.sh \.$' "$workflow" || true)"
  if [ "$consumer_count" -ne 1 ]; then
    echo "::error::$(basename "$workflow") must invoke the single-source leakage scanner exactly once"
    exit 2
  fi
done

echo "leakage-gate selftest: ${#PROBES[@]} pattern classes, each planted separately"
echo

git -C "$REPO_ROOT" archive HEAD --prefix=base/ | tar -x -C "$TMP"
if ! base_output="$(scan "$TMP/base" 2>&1)"; then
  echo "::error::selftest: the CLEAN tree already trips the scan:"
  echo "$base_output"
  echo "Fix the real contamination before trusting any negative control."
  exit 2
fi
echo "  baseline: clean tree is silent"
echo

# Prove the sealed-evidence exception is a byte pin, not a path exemption.
pinned_rel="research/model-evaluation/pilots/accelerated-v1/artifacts/tasks/boundary-feature/functional-oracle.mjs"
pinned_dir="$TMP/pinned_exception"
mkdir -p "$pinned_dir/$(dirname "$pinned_rel")"
cp "$TMP/base/$pinned_rel" "$pinned_dir/$pinned_rel"
if ! scan "$pinned_dir" >/dev/null 2>&1; then
  echo "  MISS  exact sealed evidence was not recognized"
  fails=$((fails+1))
fi
printf '\n%s\n' "$t1" >> "$pinned_dir/$pinned_rel"
if changed_output="$(scan "$pinned_dir" 2>&1)"; then
  echo "  MISS  changed sealed evidence escaped its digest pin"
  fails=$((fails+1))
else
  case "$changed_output" in
    *"$pinned_rel"*) ;;
    *) echo "  MISS  changed sealed evidence failed without naming its path"; fails=$((fails+1));;
  esac
fi
[ "$fails" -eq 0 ] && echo "  OK    sealed-evidence exception is path- and digest-scoped"
echo

# The public security-address exception is exact in both content and location. It must not become
# a file-wide exemption, and the same address outside SECURITY.md must remain a leak.
contact="mitchell@${o1}${o2}-labs.ai"
exception_dir="$TMP/security_exception"
mkdir -p "$exception_dir"
printf 'Fallback: %s\n' "$contact" > "$exception_dir/SECURITY.md"
if ! scan "$exception_dir" >/dev/null 2>&1; then
  echo "  MISS  exact security contact was not allowlisted"
  fails=$((fails+1))
fi
printf 'Fallback: %s\n%s Systems\n' "$contact" "$NAME" > "$exception_dir/SECURITY.md"
if security_output="$(scan "$exception_dir" 2>&1)"; then
  echo "  MISS  SECURITY.md exception hid another steward reference"
  fails=$((fails+1))
else
  case "$security_output" in *SECURITY.md*) ;; *) echo "  MISS  SECURITY.md failure did not name its path"; fails=$((fails+1));; esac
fi
rm -f "$exception_dir/SECURITY.md"
printf 'Fallback: %s\n' "$contact" > "$exception_dir/README.md"
if outside_output="$(scan "$exception_dir" 2>&1)"; then
  echo "  MISS  security contact escaped its file-scoped allowlist"
  fails=$((fails+1))
else
  case "$outside_output" in *README.md*) ;; *) echo "  MISS  outside-contact failure did not name its path"; fails=$((fails+1));; esac
fi
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
  if hits="$(scan "$d" 2>&1)"; then
    echo "  MISS  ${label} — planted and NOT caught"
    fails=$((fails+1))
  else
    case "$hits" in
      *PROBE.txt*) echo "  OK    ${label}" ;;
      *)           echo "  MISS  ${label} — failure did not name the planted file"; fails=$((fails+1)) ;;
    esac
  fi
done

echo
if [ "$fails" -ne 0 ]; then
  echo "::error::leakage-gate selftest: ${fails} pattern class(es) did not catch their probe."
  echo "This gate is the flip-day guard; a class it cannot catch is a class that ships."
  exit 1
fi
echo "leakage-gate selftest: PASS — all ${#PROBES[@]} pattern classes caught their probe."
