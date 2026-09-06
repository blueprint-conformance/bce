# The clauses, one at a time

Read this when a specific violation needs deciding, not up front.

**Where the patterns live.** Every clause's exact regular expression, severity and path narrow is
in `spec/skill-standard/skill-standard.blueprint.json` in the bce repository — the blueprint is the
single encoding, and it is deliberately **not restated here**. Two copies of a rule drift; one
copy cannot. This page carries the rationale, the failure mode, and where to see the clause go red.

There is a second reason this page holds no literals: this file lives under `skills/`, so it is
itself scanned by the standard. A page that quoted its own forbidden patterns would redden the gate
it documents. That is not an inconvenience — it is the clause working on the clause's own
documentation, which is a reasonable thing to have discovered.

**Where the reds live.** `examples/skill-standard/drift/` in the bce repository. Every clause below
names the fixture file that reddens it. Reproduce any of them with:

```bash
bce run --blueprint spec/skill-standard/skill-standard.blueprint.json \
  --ct-repo examples/skill-standard/drift --no-pin --extractor ast --out /tmp/drift.json
```

---

## S1 — frontmatter-key-portability · high · fixture `drift/skills/greet`

**Refuses:** near-miss spellings of real frontmatter keys — an underscore where the format uses a
hyphen, or a hyphen where it uses an underscore.

**Why it is worth a clause.** This is the quietest failure in the format. The file parses. Nothing
warns. The key is simply not read by anything, so whatever the author was configuring has never
been in effect, on any machine, since the day it was written. Every other clause here describes
something that at least behaves oddly; this one describes something that behaves as though the line
were absent — because it is.

**The fix is a decision, not a rename.** Check `portability-matrix.md` beside this file first.
Several of these keys are platform extensions rather than portable core, so re-spelling one
correctly makes the file non-portable to consumers that reject unknown keys. Deleting it is often
the better answer, and is always the answer when nobody can say what the key was for.

**Measured hit rate.** On a private 34-skill library: 30 hits across 30 of the 34 skills, all of
them one key, all of them silently ignored for the life of the library.

## S2 — name-shape · high · fixture `drift/skills/greet`

**Refuses:** a `name` that is not lowercase letters, digits and hyphens, at most 64 characters.

**Why.** The name is an identifier several consumers derive things from, and they do not all
normalise the same way. A capital or a space produces a skill whose directory and declared name
disagree, and which of the two wins is consumer-specific. Also make the directory match: fixing the
frontmatter alone leaves the same disagreement in place.

## S3 — description-placeholder · high · fixture `drift/skills/stub`

**Refuses:** a description left as scaffolding.

**Why.** The description is what a router matches on. A placeholder is a skill that installs
correctly, appears in listings, and never fires — which reads to its author as the model ignoring
them, and is one of the hardest things to debug from the outside because everything *looks*
installed.

## S4 — description-budget · medium · fixture `drift/skills/bloated`

**Refuses:** a description of 1,025 characters or more on the line.

**Why.** The routing text is a shared budget across every installed skill; the combined description
text is truncated at 1,536 characters in the listing. So a bloated description does not merely fail
itself — it consumes the space other skills' descriptions needed to be routable. This is the one
clause whose damage lands on files other than the one that broke it.

**The fix** is not compression. Move the material into the body or into `references/`; the
description is for the routing decision only.

## S5 — description-voice · low · fixture `drift/skills/greet`

**Refuses:** a description that opens by naming itself.

**Why, and why `low`.** A router reading a description is deciding *whether this is the right
skill*. An opening that says "this is a skill" spends the highest-value words in the file on a fact
that discriminates nothing. It is a real defect with a real cost — and it is the only clause in the
set that is a matter of craft rather than correctness, which is exactly why it is `low` and why it
is the first thing to baseline if a library has more urgent reds.

## S6 — no-model-pin · medium · fixture `drift/skills/greet`

**Refuses:** a dated model identifier pinned in a shared skill.

**Why.** The pin outlives the model. The skill works, and works, and then fails for every installer
simultaneously on the day the identifier retires — presenting as a platform outage rather than as a
stale literal in a file nobody has opened in a year. A skill that genuinely needs a specific model
should say so in its body, where a human reads it, rather than pinning a value that expires.

## S7 — no-credential-material · critical · fixture `drift/skills/leaky`

**Refuses:** credential-shaped material anywhere in the tree.

**Why `critical`.** A skill directory is copied verbatim onto every installer's machine and, in a
published plugin, into a public marketplace listing. This is the only clause here whose cost is
unbounded and whose damage is not undone by fixing the file.

**The fix is two steps and the second is the important one:** remove it, then **rotate it**. It is
in the git history, and if the skill was ever installed it is on other people's disks.

**A note on the fixture.** The seeded red uses one credential shape rather than all of them,
because the bce repository's own leakage gate bans several of the others as literal strings — the
standard's clause and the repository's own scanner overlap. The remaining shapes are proven in
`tests/skill-standard.test.ts`, which assembles each probe from fragments at runtime so the test
does not trip the gate it is testing. That technique is borrowed from the leakage gate's own
self-test, which has the same problem for the same reason.

## S8 — no-author-machine-paths · high · fixture `drift/skills/greet`

**Refuses:** an absolute path into a home directory.

**Why.** It resolves on exactly one machine. On every other it either fails or — worse — finds
something else.

**The fix:** the substitution the format provides for a skill's own directory, or the plugin root.
Both are documented in `portability-matrix.md`.

**This clause has a known false-positive class.** A path into a *container's* home directory is
correctly absolute and has nothing to do with anyone's laptop, but it is the same shape and a
per-line regular expression cannot tell them apart. Measured on that same 34-skill library: 24
hits, 17 genuine author-home paths, 7 of the container class.

**Do not narrow the clause to make those go away.** On a Linux author's machine that same shape is
the true positive, and tuning a rule around one sample's container user is fitting the rule to the
sample. Baseline them: `bce baseline` records them as accepted, shrink-only, and visible in a diff
— which is the difference between an exception and a weakening.

## S9 — no-harness-imitation · critical · fixture `drift/skills/leaky`

**Refuses:** text shaped like harness framing, and instructions to disregard prior instruction.

**Why `critical`.** A skill installed from a marketplace is untrusted by provenance the moment it
arrives. Content of this shape is an injection surface, and the standard's position is that it is
refused at the source rather than left for every downstream consumer to sanitize independently.

There is no legitimate reason for a distributed skill to carry it. The fix is deletion.

## S10 — no-placeholder-body · low · fixture `drift/skills/greet`

**Refuses:** generator scaffolding left in the body.

**Why.** It is the most legible possible signal that the file was never finished, and it is the
first thing a reader who is deciding whether to trust the skill will see. `low` because it is
cosmetic in effect — but it is cosmetic in the way a construction sign in a shipped product is
cosmetic.

## S11a / S11b / S11c — key-material files · critical · fixture `drift/skills/leaky`

**Refuses:** a dotenv, a PEM file, or an SSH private key inside a skill directory.

Three clauses rather than one because the `forbiddenFile` constraint takes a single glob. This is
the file-shaped sibling of S7: S7 catches a credential pasted into a body, S11 catches one
committed beside it.

**The fix:** delete, rotate, and add the glob to `.gitignore` so it cannot come back. Note that a
standard `.gitignore` already ignores dotenv files, which is why this clause mostly fires on trees
where one was force-added — and why it is worth having, because that is a deliberate act nobody
reviewed.

## S13 — surface-floor

Not a constraint. `extraction.minFiles` fails a scan closed when it resolves fewer than two files,
and the engine separately hard-fails a run in which zero constraints were implemented.

This is the anti-vacuity guard, and it is the one to understand before trusting any green from this
blueprint: a blueprint aimed at a path that has moved would otherwise score 100 against nothing at
all, forever, looking exactly like a clean tree. Read `coverage.filesScanned` before the score.

## There is no S12

A clause refusing a vendored dependency tree inside a skill directory was specified and then
**measured unenforceable**: the extractor's directory walk skips `node_modules` by name before any
glob is applied. On a tree carrying such a directory, the scan resolved 2 files, the constraint
produced 0 violations, and the blueprint scored 100/pass.

Shipping it would have added a clause that is green on precisely the tree it exists to refuse. It
lives in the required-half checklist instead, where `find` decides it honestly. The number is left
unused rather than reassigned, so that a reader who has seen the original specification can tell
the difference between a renumbering and a removal.
