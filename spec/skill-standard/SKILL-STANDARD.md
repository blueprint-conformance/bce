# The skill-standard — an enforceable shape for a `skills/` tree

An Agent Skill is a directory holding a `SKILL.md`: YAML frontmatter, then a body of instructions
a model will follow literally. The format is open and deliberately permissive, which is what makes
it portable — and what makes a skill library rot quietly. A misspelled frontmatter key is ignored
rather than rejected. A placeholder description loads fine and never routes. A key pasted into a
body ships to every installer. None of these fail anything today.

This document is the normative half of the answer: a small set of properties a `skills/` tree
should hold, each written so a machine can decide it. The other half is
`skill-standard.blueprint.json` beside this file — the same properties as bce constraints, so a
pull request that breaks one is refused instead of reviewed.

**Status: proposed, version 0.1.0.** It is offered for use and for argument. Nothing here is
claimed to be settled, and the clause set is expected to change as it meets other people's
libraries.

## Scope, and the two halves

The standard governs a tree of skill directories — the `skills/` layout a plugin, a marketplace
entry, or a `.claude/skills/` directory uses. It governs the file's *shape*, never its subject
matter: it has no opinion about what a skill is for, only about whether the file will behave the
way its author expects on someone else's machine.

The clauses split by what the engine can actually decide, and the split is load-bearing:

**The FORBIDDEN half is gated.** bce's enforceable-on-a-markdown-surface constraint types are
`forbiddenPattern` (a per-line regular expression, with an optional path narrow), `forbiddenFile`
(a filename glob over the scanned set), and the `extraction.minFiles` floor. Every clause below
marked *gated* compiles to one of those, lives in the blueprint, and blocks a merge.

**The REQUIRED half is not gated, and this document will not pretend otherwise.** The engine has
no required-content constraint type. `requiredEvidence`, `minimumMetric` and `customPolicy` are
declared-but-run-only — `bce teeth` reports them INDETERMINATE, which is the honest answer, not a
pass. So "the frontmatter fence is on line 1", "a description exists", "the body is under 500
lines" cannot be blueprint clauses. They are checks, run by the `skill-tuning` skill and by
`tests/skill-standard.test.ts`, and they are listed here as such. A standard that claimed them as
gated would be describing a gate that does not run.

## The gated clauses

The rule is normative here; the machine-readable encoding — the exact regular expression, the
severity, the path narrow — lives in `skill-standard.blueprint.json` and is **not restated in this
document**, so the two can never disagree. Read the rule here; read the pattern there.

| id | severity | The rule |
|---|---|---|
| **S1** frontmatter-key-portability | high | A frontmatter key must be a key some consumer actually reads. The refused set is the near-miss spellings of real keys — an underscore where the format uses a hyphen, or a hyphen where it uses an underscore. These are the worst kind of wrong: the file parses, the key is silently dropped, and the author's intent never takes effect anywhere. |
| **S2** name-shape | high | `name` must be lowercase, digits and hyphens, at most 64 characters. Anything else — a capital, a space, an underscore, an over-long name — is a name some consumer will reject or normalise differently from the directory it sits in. |
| **S3** description-placeholder | high | `description` must not be scaffolding left in place (`TODO` and its siblings). The description is what a router matches on; a placeholder is a skill that loads and never fires, which reads to the author as the model ignoring them. |
| **S4** description-budget | medium | A `description` of 1,025 characters or more on one line is refused. The listing truncates the combined description text at 1,536 characters across all skills, so one bloated description does not just fail itself — it crowds the routing text of everything beside it. |
| **S5** description-voice | low | A description must not open by naming itself ("This skill…", "A skill that…", "Helps you…"). The reader of a description is a router deciding *whether this is the right skill*; a self-referential opening spends the highest-value words in the file saying nothing that discriminates. Severity is deliberately `low`: it is a real defect, and it is the one clause here that is a matter of craft rather than correctness. |
| **S6** no-model-pin | medium | A shared skill must not pin a dated model id. The pin outlives the model: the skill keeps working until the id is retired, then fails for every installer at once, in a way that looks like a platform outage rather than a stale literal. Omit the key, or inherit. |
| **S7** no-credential-material | critical | No credential-shaped material anywhere in the tree. A skill directory is copied verbatim onto every installer's machine and, in a plugin, into a public marketplace. This is the one clause whose cost is unbounded. |
| **S8** no-author-machine-paths | high | No absolute path into an author's home directory. It resolves on exactly one machine and silently misbehaves on every other. The portable form is the substitution the format provides for a skill's own directory, or the plugin root. |
| **S9** no-harness-imitation | critical | A skill body must not contain text shaped like harness framing or an instruction to disregard prior instruction. A skill is untrusted-by-provenance the moment it is installed from a marketplace; content that imitates the harness is an injection surface no consumer should be asked to sanitize. |
| **S10** no-placeholder-body | low | No template scaffolding left in the body — the generated placeholder tokens a skill generator emits. Shipped scaffolding is the most legible possible signal that the file was never finished. |
| **S11a/b/c** no-key-material-files | critical | No dotenv, no PEM file, no SSH private key inside a skill directory. Three clauses rather than one because `forbiddenFile` takes a single glob. This is the file-shaped sibling of S7: S7 catches a credential pasted into a body, S11 catches one committed beside it. |
| **S13** surface-floor | — | Not a constraint but the extraction floor: a scan resolving fewer than two files fails closed. It is the anti-vacuity guard — a blueprint whose paths have gone stale would otherwise score 100 against nothing. The engine additionally hard-fails a run in which zero constraints were implemented. |

There is no S12. See below.

## The required half — checks, not clauses

Run by the `skill-tuning` skill and asserted for this repository's own tree in
`tests/skill-standard.test.ts`. Each is a property the forbidden half structurally cannot express,
because expressing "X must be present" as "no line may fail to be X" is not something a per-line
forbidden-content regex can do.

1. Every skill directory holds a `SKILL.md`.
2. The frontmatter fence is the first line of the file, and it closes.
3. `name` and `description` are both present and non-empty, and `name` matches its directory.
4. The body is under 500 lines. Longer material belongs in `references/`, read on demand.
5. `license` is present on a skill that is published — a plugin, a marketplace entry, a public
   repository. It is not required of a skill that never leaves its own tree.
6. Frontmatter keys are confined to the portable core unless a platform extension is a deliberate
   choice, made knowing it makes the file non-portable (`references/portability-matrix.md` in the
   `skill-tuning` skill carries the two lists and the rejection message you get for crossing them).
7. No vendored dependency tree inside a skill directory — see S12 below for why this is here and
   not in the gated half.
8. Every command line the skill teaches names a real verb and real flags of the tool it drives.
   This one is worth the effort it costs: a stale command in a skill is not a stale doc, it is an
   agent confidently running a flag that has never existed and reading the refusal as a repository
   problem. `tests/skill-contract.test.ts` is this check for the `bce` skill, with the CLI source
   as the oracle.

## Deliberately not clauses

**S12 — no vendored dependencies — is measured unenforceable, and is therefore a check.** A
`forbiddenFile` glob over `skills/**/node_modules/**` cannot fire: the extractor's directory walk
skips `node_modules` by name before any glob is applied. Measured on a tree carrying
`skills/greet/node_modules/leftpad/index.js`, the scan resolved 2 files, the constraint produced 0
violations, and the blueprint scored 100/pass. Shipping it would have added a clause that is green
on exactly the tree it exists to refuse — the failure this whole project is about. It lives in the
required half, where a `find` decides it honestly.

**Line endings and byte-order marks.** A CRLF or BOM clause is omitted because the per-line
scanner's carriage-return handling is unverified here. The house rule is that a clause ships only
with a seeded fixture proving it can go red; until that fixture exists, the clause does not.

**Anything about a skill's subject matter.** Out of scope, permanently. The standard decides
whether a file will behave as its author expects, not whether the author was right.

## Proving it can go red

`examples/skill-standard/` carries the mutation corpus: a `clean/` tree that must stay green and a
`drift/` tree seeded so that **every** clause has a demonstrated red. This is the substance proof,
and it is worth being exact about why it is needed even though `bce teeth` already reports
`toothed`:

- Against this repository's own (clean) `skills/` tree, teeth reports 3 constraints with
  extractor-real teeth and 10 `evaluator-refutable`. `evaluator-refutable` is an honest verdict
  meaning the mutation was synthetic — the evaluator can refute the constraint, which is *not* the
  same as the constraint biting real extractor evidence.
- Against the seeded `drift/` corpus, teeth reports **13/13 extractor-real**, because the
  violations are really there and the extractor really recorded them.

The second number is the one that means something. A clause with no seeded red is decoration
whatever the verdict word says.

## Adopting it

The `skill-tuning` skill drives the whole path — inventory, copy the blueprint, run, read the
violations, fix, prove the red, wire the gate — and knows the brownfield route for a library that
already drifts (advisory, then a shrink-only baseline, then enforced). Start there rather than
here.

Two things worth knowing before you do:

- **The clause set is small on purpose.** Eleven refusals and a floor. Each earns its place by
  having a failure mode that is silent — the file works, the author believes it works, and the
  intent is not in effect. Clauses that merely encode taste were considered and mostly cut; S5 is
  the one survivor and it is `low` for that reason.
- **Expect S1 to be your largest red.** The near-miss spellings are exactly the ones a plausible
  author invents. Measured on a private 34-skill library during this standard's development: score
  0, 54 violations, of which 30 were a single silently-ignored key repeated across 30 of the 34
  skills. That is the clause working, not the clause being wrong — the authors' intent had never
  been in effect anywhere, and nothing had ever said so.
- **Expect S8 to produce some false positives, and do not narrow it.** In that same measurement
  S8 returned 24 hits: 17 genuine author-home paths, and 7 paths into a *container's* home
  directory — correctly absolute, nothing to do with anyone's laptop. A per-line regular
  expression cannot tell those apart; they are the same shape. Narrowing the clause to the macOS
  form would fit the rule to one sample and lose the true positive on every Linux author's
  machine. The honest handling of a legitimate absolute remote path is `bce baseline`: record it
  as accepted, shrink-only, visible in a diff.
