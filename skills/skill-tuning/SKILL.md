---
name: skill-tuning
description: Grade an Agent Skill — or a whole skills/ tree — against the enforceable skill-standard and drive it green: frontmatter portability, description discipline, no credential material, no author-machine paths, size budgets. Use when authoring a new SKILL.md, when adopting the standard across an existing skill library, before publishing a plugin or a marketplace entry, or when a skill loads but never fires and nobody can say why.
license: Apache-2.0
---

# skill-tuning — grade a skills/ tree against a standard that can go red

An Agent Skill fails quietly. A misspelled frontmatter key is dropped, not rejected. A placeholder
description loads and never routes. An absolute path into the author's home directory resolves on
exactly one machine. Every one of those files looks fine, passes review, and does not do what its
author believes it does.

This skill grades a skills tree against the **skill-standard** — a set of properties written so a
machine can decide them — and drives the tree green. The gated half is a bce blueprint, so a change
that breaks it is refused rather than reviewed. The rest is a checklist run here, honestly labelled
as such.

## When to fire

- **Authoring a new `SKILL.md`.** Grading it before it ships is minutes; finding the dropped key
  after twenty people installed it is not.
- **Adopting the standard across an existing library.** Expect red on day one. There is a
  brownfield path below that does not require fixing everything first.
- **Before publishing a plugin or a marketplace entry.** A skill directory is copied verbatim onto
  every installer's machine. Whatever is in it, ships.
- **A skill loads but never fires.** The usual cause is the description — a placeholder, or a
  self-referential opening that gives a router nothing to match on. S3, S4 and S5 name that
  directly.
- **A frontmatter key that "does nothing".** Almost always a near-miss spelling. S1 is the clause,
  and it is the highest-hit-rate clause on real libraries.

Do **not** reach for this to judge whether a skill is *good*. The standard decides whether a file
behaves the way its author expects on someone else's machine. It has no opinion about the subject
matter, and it should not acquire one.

## The two halves, and why the split is stated out loud

The engine's enforceable-on-markdown constraint types are `forbiddenPattern` (a per-line regular
expression with an optional path narrow), `forbiddenFile` (a filename glob), and the
`extraction.minFiles` floor. There is no required-content type — `requiredEvidence`,
`minimumMetric` and `customPolicy` are declared-but-run-only and `bce teeth` reports them
INDETERMINATE.

So: **the forbidden half is the blueprint and blocks a merge. The required half is the checklist in
this skill, and does not.** Both are real; only one is a gate. Do not report the checklist items as
gated — that is the exact class of claim this whole tool exists to refuse.

## The procedure

### 1. Inventory

```bash
find skills -name SKILL.md | sort
```

Note the count. It is the denominator for everything that follows, and a scan that later resolves
fewer files than this is a scoping mistake, not a clean tree.

### 2. Copy the blueprint and aim it at the tree

From a bce checkout, copy `spec/skill-standard/skill-standard.blueprint.json` into the target
repository's `.blueprints/`, then edit exactly three things:

- `scope.repositories` → the target repository, as `org/repo`.
- `scope.paths` and `extraction.paths` → where the skills actually live. `skills/**` for a plugin
  or marketplace repository; `.claude/skills/**` for a project-local library.
- every constraint's `path` narrow → the same prefix. The narrows read `skills/**/SKILL.md` and
  `skills/**`; if the tree is at `.claude/skills/`, they must be rewritten to match or those
  clauses will scan nothing and pass vacuously.

That third step is the one that gets missed, and it fails silently in the worst direction: the
constraint is present, the blueprint is valid, and the clause grades an empty set. After editing,
prove the aim before trusting any verdict:

```bash
bce validate --blueprint .blueprints/skill-standard.blueprint.json
```

### 3. Run it

```bash
bce run \
  --blueprint .blueprints/skill-standard.blueprint.json \
  --ct-repo . --no-pin --extractor ast \
  --out skill-standard-report.json
```

`--no-pin` grades the working tree. Without it the run pins to a committed revision via
`git archive`, which is the right default for CI and the wrong one while you are editing — a green
on the pinned tree says nothing about the file open in front of you.

Read `coverage.filesScanned` in the report FIRST, before the score. If it does not match the
inventory from step 1, the paths are wrong and the score is meaningless. A blueprint whose scan
resolves nothing is the failure mode this engine is built to make impossible, and step 2 is where
it gets introduced.

Then read the violations. Each carries the constraint id, the severity, and `file#Lline`.

### 4. Fix, by clause

The rewrite move per clause. The exact regular expressions live in the blueprint — read them there
rather than from any prose, including this page, so the two can never disagree.

| clause | the move |
|---|---|
| **S1** frontmatter-key-portability | Decide what the key was *meant* to do, then use the spelling a consumer actually reads — or delete it. Check `references/portability-matrix.md` first: several of these keys are platform extensions, so re-spelling one makes the file non-portable, and deleting it is often the better fix. |
| **S2** name-shape | Lowercase, digits and hyphens, ≤64 characters, and equal to the directory name. Rename the directory too, or the two disagree and consumers differ on which wins. |
| **S3** description-placeholder | Write the description. One sentence saying what it does, one saying when to reach for it, key use case first. |
| **S4** description-budget | Cut it under 1,024 characters on the line. If the material is genuinely needed, it belongs in the body or in `references/`, not in the routing text every other skill shares a budget with. |
| **S5** description-voice | Delete the self-referential opening and start with the verb. A router is deciding *whether this is the right skill*; "This skill…" spends the highest-value words in the file on a word that discriminates nothing. |
| **S6** no-model-pin | Remove the dated model id. Omit the key, or inherit. |
| **S7** no-credential-material | Remove it, then **rotate it** — it is in the git history now, and if the skill was ever installed it is on other machines. Fixing the file is the smaller half of this one. |
| **S8** no-author-machine-paths | Replace with the substitution the format provides for a skill's own directory, or the plugin root. See the note below on the false-positive class before assuming every hit is a defect. |
| **S9** no-harness-imitation | Delete it. There is no legitimate reason for a distributed skill to carry text shaped like harness framing or an instruction to disregard prior instruction. |
| **S10** no-placeholder-body | Finish the file, or delete the scaffolding. |
| **S11a/b/c** key-material files | Delete the file, rotate whatever was in it, and add the glob to `.gitignore` so it cannot return. |

**S8 has a real false-positive class, and it is not a bug to route around.** An absolute path into a
*container's* home directory is correctly absolute and has nothing to do with anyone's laptop — but
it is the same shape as an author-machine path, and a per-line regular expression cannot tell them
apart. Measured on a 34-skill library: 24 hits, 17 genuine, 7 of this class. Do not narrow the
clause to make them go away; on a Linux author's machine that same shape is the true positive.
Baseline them instead (step 6).

### 5. Prove the red

A clause you have not seen fail is a clause you hope works.

```bash
bce teeth --blueprint .blueprints/skill-standard.blueprint.json --ct-repo . --no-pin --extractor ast
```

Read the verdict as a measurement, not a word to satisfy. On a **clean** tree most of these clauses
report `evaluator-refutable`: the mutation was synthetic, which proves the evaluator can refute the
constraint and **not** that the constraint bites real extractor evidence. That is an honest verdict,
not a failure.

The substance proof is the seeded corpus that ships with the standard:

```bash
bce run --blueprint spec/skill-standard/skill-standard.blueprint.json \
  --ct-repo examples/skill-standard/drift --no-pin --extractor ast --out /tmp/drift.json
bce run --blueprint spec/skill-standard/skill-standard.blueprint.json \
  --ct-repo examples/skill-standard/clean --no-pin --extractor ast --out /tmp/clean.json
```

`drift/` reddens every clause; `clean/` scores 100. Against `drift/`, `bce teeth` reports 13/13
extractor-real, because the violations are really there. If you add a clause, it does not ship until
`drift/` reddens it too.

**A hazard the corpus creates, and how it is contained.** `examples/skill-standard/drift/` holds a
deliberately broken skill — a placeholder description, a fake key, harness-imitating text. It is
inert for exactly two reasons, and both must stay true:

1. It lives under `examples/`, which no plugin loader ever scans. Only `skills/` is auto-discovered.
2. It is not named in the plugin manifest's `skills` array. **That array is ADDITIVE, not an
   allowlist** — it does not narrow discovery, it ADDS directories from outside `skills/`. Naming a
   fixture directory there would publish a deliberately broken skill into every installer's session,
   and the manifest would still be perfectly well-formed, so no schema check would see it.

Never move a fixture under `skills/`, and never name one in the `skills` array. In the bce
repository `tests/skill-contract.test.ts` asserts both; an adopting repository should copy that
assertion along with the corpus.

### 6. Adopting on a library that already drifts

Day one on a real library is red — expect it, and do not fix it by weakening the blueprint. Three
rungs, each a committed, reviewable artifact:

1. **Advisory.** Commit `.bce-mode.json` containing `{ "mode": "advisory" }`. Full verdict printed,
   nothing blocked. Nothing is suppressed — only the build consequence is.
2. **Baseline.** `bce baseline` records today's violations as the accepted set; new ones block,
   recorded ones are shown and counted but do not. The file only ever shrinks. Preview with
   `bce baseline --dry-run`. This is the right home for the S8 container-path class.
3. **Graduate.** `bce graduate` flips advisory to enforced. Reversing it requires
   `bce graduate --downgrade --rationale "<why>"`, so a quiet weakening cannot happen.

### 7. The required-half checklist

Not gated. Run it, and report it as a checklist.

- [ ] Every skill directory holds a `SKILL.md`.
- [ ] The frontmatter fence is line 1 and it closes. (`head -1` is `---`.)
- [ ] `name` and `description` are present and non-empty; `name` equals the directory name.
- [ ] Body under 500 lines: `wc -l SKILL.md`. Deeper material goes in `references/`, read on demand.
- [ ] `license` present on anything published — a plugin, a marketplace entry, a public repository.
- [ ] Frontmatter confined to the portable core, unless a platform extension is a deliberate,
      recorded choice. `references/portability-matrix.md` carries both lists and the rejection
      message you get for crossing them.
- [ ] Bundled paths use the skill-directory or plugin-root substitution, never a literal path.
- [ ] No vendored dependency tree inside a skill directory. This is a checklist item **because it
      cannot be gated**: the extractor's directory walk skips `node_modules` by name before any
      glob applies, so a constraint aimed at it scores 100 against a tree that carries one.
      Measured, not assumed. `find skills -type d -name node_modules` decides it.
- [ ] Every command line the skill teaches names a real verb and real flags of the tool it drives.
      Worth automating: a stale command in a skill is an agent confidently running a flag that has
      never existed and reading the refusal as a repository problem. `tests/skill-contract.test.ts`
      in the bce repository is this check with the CLI source as its oracle.

### 8. Wire the gate

```bash
bce gate --repo . --extractor ast --all
```

Two ways a required check goes wrong, both of which wedge a merge queue rather than fail it: a
workflow-level path filter (a path-filtered required check never reports on a PR outside its
filter), and a moving version tag on the engine (the same tree then yields different verdicts on
different days — pin an exact version). The gate self-scopes, so a PR touching nothing in any
blueprint's scope passes trivially; make sure the workflow also runs on the merge-queue event.

## The honesty invariants

1. **Never narrow a clause to make a red go green.** If a hit is a genuine false positive,
   baseline it — that is visible in a diff. Editing the pattern is not.
2. **Read `filesScanned` before the score.** A blueprint aimed at the wrong path scores 100
   forever, and looks exactly like a clean tree.
3. **Never report a checklist item as gated.** The required half is checked here, by an agent, and
   an agent's report of its own work is not evidence. Say which half a result came from.
4. **Do not claim a clause works until you have produced its red.** The seeded corpus exists so
   that this costs one command.
5. **`--no-pin` for the working tree, pinned for committed proof.** Mixing them up produces a green
   that describes a tree you are not looking at.
6. **A fixture is never a shipped skill.** Under `examples/`, never under `skills/`, never in the
   manifest's `skills` array.

## References

Loaded on demand, not up front:

- `${CLAUDE_SKILL_DIR}/references/skill-standard-clauses.md` — every clause with its rationale, its
  failure mode, and the fixture that proves its red.
- `${CLAUDE_SKILL_DIR}/references/portability-matrix.md` — the portable core versus the platform
  extensions, and what crossing that line costs.

The normative standard itself, with the required half and the deliberately-omitted clauses:
<https://github.com/blueprint-conformance/bce/blob/main/spec/skill-standard/SKILL-STANDARD.md>

(Full URL on purpose: once this skill is installed, it is nowhere near the repository, so a
repo-relative path would resolve to nothing.)
