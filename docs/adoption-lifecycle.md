# Adoption lifecycle

The shortest safe path from “new repository” to a self-correcting BCE gate is:

1. `bce doctor --repo .` diagnoses prerequisites without writing.
2. Author a falsifiable draft, then `bce adopt --repo . --blueprint draft.json --engine bce-engine@X.Y.Z`.
   Adoption is advisory and proposal-only; generated CI has read-only permissions.
3. Fix scope and teeth findings. `bce teeth ... --require-extractor-real` requires a real extractor
   mutation. Evaluator-only policy needs a committed, exact-reference reviewed waiver.
4. A human steward runs `bce ratify` with reviewer, substantive rationale, explicit UTC time, and
   `--human-reviewer`. Ratification bumps the version and appends policy history.
5. Use `bce gate` on every pull request. Agents use MCP `doctor_repository`, `run_gate`,
   `assess_teeth`, and `check_baseline` to diagnose and repair code. MCP cannot ratify or amend.
6. Existing debt may be captured once through a reviewed baseline. Thereafter `bce baseline --check`
   reports new debt and emits a shrink-only patch; it never silently grows the wall.
7. Graduate advisory to enforced only through the existing attended graduation proof. Configure and
   externally verify branch protection; committed configuration alone is not proof of enforcement.
8. Amend approved policy with a higher approved version, compatibility declaration, attended review,
   teeth proof, and append-only history. Weakening needs `--accept-weakening`.
9. Before changing an engine pin, run `bce upgrade --check --candidate-engine X.Y.Z --repo .`.
   The command is read-only and refuses ranges, malformed blueprints, zero discovery, and floor misses.

Exit semantics are uniform: 0 means the requested check passed, 1 means a gradeable violation or
maintenance action exists, and 2 means BCE refused to claim a result. Never reinterpret refusal as
success, and never fix a code violation by silently weakening policy.

