# Agent Skill listing drafts — STAGED, NOT SUBMITTED

> **DRAFT — nothing here has been submitted anywhere.** These are the
> submission texts for the Agent Skill in [`skills/bce/`](../../skills/bce/SKILL.md),
> written ahead of the public flip so launch day is a reveal rather than a
> drafting session. **[operator]** owns every submission: a listing points
> at a public repository, so no entry may be filed before the flip
> ([public-flip-checklist.md](public-flip-checklist.md) Phase 2). Re-check
> every claim against CI on the submission morning; nothing here may outrun
> the tree.

## What is being listed

One skill, in the folder-per-skill Agent-Skills format: `skills/bce/SKILL.md`,
frontmatter `name: bce`. It teaches the whole lifecycle — author a blueprint,
validate it, run it, prove it can go red, wire it as a gate — plus the honesty
invariants that keep a green verdict meaningful. The skill drives the `bce` CLI,
which the user installs separately.

It reaches an installer two ways, and a listing should name whichever one that
directory is for:

- **As a Claude Code plugin.** The repository is also a plugin marketplace
  ([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)),
  offering one plugin, `blueprint`, whose source is the repository root
  ([`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)). Two lines
  for the installer — `/plugin marketplace add blueprint-conformance/bce` then
  `/plugin install blueprint@bce` — after which the skill loads as
  `blueprint:bce`. This is the shorter path and the one a plugin directory wants.
- **As a directory copy** into `.claude/skills/` (or the consumer's
  equivalent), unchanged and still supported. `skills/bce` does not move, so
  every install line already written stays true.

The install string `blueprint@bce` is fixed by two names — the marketplace's
`bce` and the plugin's `blueprint` — and changing either after a listing is
filed breaks every published install line. They are settled; do not re-open them
to fit a directory's field.

Distinct from the two surfaces already shipped, and the listing text should say
so rather than blur them: the [house-rules snippets](../../integrations/README.md)
are the always-loaded done-check for a repository that already has a blueprint,
and the `bce-mcp` server exposes the engine as six logic-free, read-only tools. The skill
is the one that gets a contract to exist in the first place.

## Pre-submission gates (all must hold)

1. **[operator]** The repository is public and `skills/bce/SKILL.md` resolves at
   a stable URL. A listing that points into a private repository is a dead link.
2. **[agent]** CI green on main HEAD — job names `build-test-prove`,
   `lane-b-self-gate`, `leakage-gate`, `banned-phrases`. The skill's own
   contract test (`tests/skill-contract.test.ts`) runs inside `build-test-prove`.
3. **[agent]** `bce` is installable by the exact command the listing prints,
   **and what it installs can actually go red**. The listing must use the exact
   `bce-engine@0.1.5` pin, never a range or `latest`. Verify the registry artifact's
   signatures and provenance, then run `bce demo` and require its GREEN/RED
   discrimination before printing any install line.
4. **[operator]** Read each directory's own submission rules before filing.
   The texts below are content, not a claim about any particular directory's
   process.
5. **[agent]** If the listing prints the plugin install lines, both manifests
   validate on main HEAD: `claude plugin validate . --strict` exits 0. This runs
   in `build-test-prove` on every push, so the check is normally already made;
   re-run it on the submission morning anyway, because a listing outliving its
   manifest is the same failure as gate 3 in a different file. Note the strict
   flag is load-bearing: the runtime ignores an unrecognized manifest key at load
   time, so without it a typo'd field is invisible until an installer's skill
   silently fails to appear.

## Short description (one line, ~120 characters)

> Turn an architectural rule into an enforced merge contract: author a
> blueprint, prove it can go red, gate on it.

Alternates, if a directory's field is tighter or wants a verb-first shape:

- `Author an architecture contract and gate your repo on it — with a check that the rule can actually fail.`
- `Make "we never import X here" a merge contract instead of a review comment.`

## Long description (listing body)

> A coding agent will report a change done when it typechecks and the tests
> pass — while the architecture quietly drifts. No single diff is wrong; three
> weeks later the web layer imports the database client, a boundary is crossed,
> a service reaches a host it was never supposed to reach.
>
> This skill drives **bce**, a fail-closed architecture-conformance gate. You
> author an EngineeringBlueprint — a versioned contract naming the rule, the
> files it holds over, and the severity of breaking it — and the engine measures
> the code against it: a deterministic score, named violations with file and
> line, and evidence anyone can re-derive offline.
>
> The part that makes it more than another green check: `bce teeth` grades
> whether a constraint can actually go red. A blueprint that nothing can
> falsify reports `toothless` and exits non-zero. A green verdict means
> something only because the engine will tell you when it does not.
>
> The skill covers the whole lifecycle — author, validate, run, teeth, gate —
> including the graduated adoption path for a repository that already violates
> its own rules (advisory, then a shrink-only baseline, then enforced), and the
> honesty invariants that keep the result real: never hand-write the contract
> JSON when the authoring verb exists; never lower a threshold to make a red
> green; treat a teeth verdict as a measurement, not a string to satisfy.
>
> There are no skip flags. Adoption posture is committed configuration that
> shows up in a diff, never an invisible override.

## Suggested tags

`architecture` · `conformance` · `ci` · `code-review` · `governance` ·
`static-analysis` · `agent-safety`

Pick from whatever vocabulary the directory actually offers; do not invent tags
to fill a field.

## Claims allowed in a listing, and their sources

Every line above traces to something in the tree. If a directory's form invites
a stronger claim, the answer is no.

| Claim | Where it is true |
|---|---|
| Fail-closed, no skip flags | [`docs/exit-codes.md`](../exit-codes.md), and the CLI has no such flag to find |
| Deterministic, re-derivable evidence | [`docs/evidence-format.md`](../evidence-format.md) |
| A constraint's refutability is graded | the `teeth` verdict set: `toothed`, `evaluator-refutable`, `toothless` |
| Graduated adoption path | [`docs/adopt-existing-repo.md`](../adopt-existing-repo.md) |
| TypeScript/JavaScript extraction (full AST) plus a Python import-graph MVP today | [`docs/extending-extractors.md`](../extending-extractors.md) — matches the README's own wording, and the `python-import-surface` profile the CLI accepts. The blueprint model is language-neutral, but a listing must not imply the extractors reach further than these two |

Claims **not** to make: any superlative, any comparison to a named competitor,
any figure about adoption or users, and anything about language support beyond
what the extractors do today.

## Where a plugin listing goes

**[operator]** Distinct from any skill directory: a Claude Code plugin is
submitted through the Console form at `platform.claude.com/plugins/submit`,
which feeds the `anthropics/claude-plugins-community` marketplace. It is a
separate filing from the skill listings above, with its own review, and it
carries the same precondition as all of them — the repository must be public
first, so it comes after the flip, never before.

Two things about that channel are worth knowing before filing rather than after:
an accepted entry is pinned by commit and updated by their CI rather than
tracking our default branch, and the repository is already a marketplace in its
own right, so nothing about this submission is required for a user to install
the plugin. It widens distribution; it is not the install path.

## Recommended next step

- [`public-flip-checklist.md`](public-flip-checklist.md) — the ordered ceremony
  these submissions come after, never before.
