# Adoption lifecycle

The shortest safe path from “new repository” to a self-correcting BCE gate is:

1. `bce doctor --repo .` diagnoses prerequisites without writing.
2. Prefer [`bce propose`](ai-first-review.md): state intent, disclose bounded context, and receive a
   validated draft plus deterministic review packet in quarantine. The offline `bce author` path and
   [`bce onboard`](onboarding.md) remain available for manual onboarding and complete CI,
   agent-context, and MCP wiring. The lower-level `bce adopt` command remains available for
   policy-only adoption with an exact published `bce-engine@X.Y.Z` pin.
   Adoption is advisory and proposal-only; generated CI has read-only permissions.
3. Fix scope and teeth findings. `bce teeth ... --require-extractor-real` marks a blueprint ready
   only when every constraint has extractor-real teeth. Any evaluator-only remainder needs a
   committed, exact-reference reviewed waiver; trivial or indeterminate constraints still refuse.
4. A human steward reviews the exact packet in a pull request. `bce review decide` resolves identity,
   current maintain/admin permission, rationale, time, commit, and review state from GitHub; `bce
   ratify` re-authenticates that decision, digest-checks the inputs, bumps the version, and appends
   policy history. Local self-attestation flags are not accepted. The resulting landing commit needs
   the repository's normal fresh CODEOWNER/required approval before merge.
5. Use `bce gate` on every pull request. Agents use MCP `doctor_repository`, `run_gate`,
   `assess_teeth`, and `check_baseline` to diagnose and repair code. MCP cannot ratify or amend.
6. Existing debt may be captured once through a reviewed baseline. Thereafter `bce baseline --check`
   reports new debt and emits a shrink-only patch; it never silently grows the wall.
7. Graduate advisory to enforced only through the existing attended graduation proof. Configure and
   externally verify branch protection; committed configuration alone is not proof of enforcement.
8. Amend approved policy with a higher draft version, exact semantic baseline, review packet,
   authenticated approving decision, extractor-real teeth proof, and append-only history. Relaxation
   is visible in the packet and has no approve-anyway flag.
9. Before changing an engine pin, run `bce upgrade --check --candidate-engine X.Y.Z --repo .`.
   The command is read-only and refuses ranges, malformed blueprints, zero discovery, and floor misses.

Exit semantics are uniform: 0 means the requested check passed, 1 means a gradeable violation or
maintenance action exists, and 2 means BCE refused to claim a result. Never reinterpret refusal as
success, and never fix a code violation by silently weakening policy.
