# Landscape re-verify — 2026-08-27

The pass that `docs/comparison.md`'s header comment points at. It records
what was checked, what changed, what could **not** be verified, and the
normal-vs-contested README decision with the evidence that decided it.

This is the manual execution of the checklist
`.github/workflows/landscape-reverify.yml` generates when the baseline goes
stale. That workflow did not fire and would not have: the prior baseline
(2026-08-06, extended 2026-08-10) was ~3 weeks old, well inside its 60-day
budget. The flip checklist's Phase 0 item 2 requires the pass before the flip
**regardless** of that clock, and the flip is near — so the pass was run by
hand. The automated nudge continues monthly afterwards and is unaffected.

**Method.** Three parallel web passes — two re-verifying the entries already
on the page against their current published documentation, one searching for
new entrants — followed by a reconciliation of the launch documents against
the current tree. Sources are linked per claim below. Where a source could
not be reached, that is recorded as UNVERIFIED rather than smoothed over; a
partial pass labelled honestly is worth more than a complete one that guesses.

---

## Per-entry verdicts

All checked **2026-08-27**.

| # | Entry | Verdict | What moved |
|---|---|---|---|
| 1 | ArchUnit (and ts-arch) | **UPDATED** | ArchUnit itself unchanged in category and actively released. The `ts-arch` parenthetical was stale. |
| 2 | dependency-cruiser | **UNCHANGED** | Healthy releases, no category shift. |
| 3 | SonarQube | **FLAGGED** | The named feature is deprecated; its successor went GA and is marketed at AI-written code. |
| 4 | OPA / conftest | **UNCHANGED** | No move toward source-code architecture conformance. |
| 5 | GitHub spec-kit / Amazon Kiro | **UPDATED** | The "no enforcement power at merge time" line was drawn too hard — partly a pre-existing gap, not new drift. |
| 6 | ESLint boundary plugins | **UNCHANGED** | Maintained; no scoring/evidence/gating growth. |
| 7 | archgate | **UNCHANGED** | Releasing fast, but along the boolean-rule axis. All four claimed differentiators still hold. |
| 8 | SGE (Spec Growth Engine) | **UNCHANGED** | Still v1, still unreleased. Verified against the paper's own text. |

Recording the unchanged rows is deliberate. A re-verify that lists only what
changed is indistinguishable from a re-verify that only looked at the rows it
expected to change.

### 1. ArchUnit (and ts-arch) — UPDATED

- [ArchUnit v1.5.0 release notes](https://github.com/TNG/ArchUnit/releases/tag/v1.5.0) — released 2026-08-04. Java 27 support, an `archunit-junit6` module, sealed-class introspection, new predicates. Entirely rule/predicate/test-integration work: **no CLI, no scoring, no merge-gate product, no evidence output.** The "asserts, in your test suite" characterization is intact.
- [ArchUnit news](https://www.archunit.org/news) — lags GitHub by a release (still lists v1.4.2, 2026-04-18); nothing in the history moves it out of the test-suite category.
- [ts-arch releases](https://github.com/ts-arch/ts-arch/releases) — last functional release **v5.4.1, 2024-12-23**; the two most recent commits (March 2026) are docs-only. **Not** archived, **no** deprecation notice, 17 open issues.
- [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) — a more recently active TypeScript port.

**Change made:** the entry no longer presents ts-arch flatly as *the*
TypeScript port; it names both with dates and tells the reader to check.

### 2. dependency-cruiser — UNCHANGED

- [Releases](https://github.com/sverweij/dependency-cruiser/releases) — **v18.2.0, 2026-08-10**, actively maintained. Recent work: `.gitignore` handling, TypeScript config support, TypeScript 7 readiness, environment-inconsistency checks, report improvements. No scoring, no conformance expansion, no merge-gate feature.
- Repo tagline unchanged; visualization still first-class.

Both page sentences hold verbatim. **No change made.**

### 3. SonarQube — FLAGGED (the substantive change of this pass)

- [SonarQube Server 2025.6 architecture docs](https://docs.sonarsource.com/sonarqube-server/2025.6/design-and-architecture/overview) — states that cycle detection and **architecture as code are deprecated, pending removal in January 2026**, to be replaced by improved architecture capabilities. The deprecated feature is exactly the one this page's heading named: architecture defined declaratively via a YAML or JSON file.
- [Architecture management GA](https://www.sonarsource.com/blog/code-architecture-management-general-availability-in-sonarqube/) — GA on SonarQube Cloud **2026-03-02**. Reverse-engineers current structure, formalizes intended architecture through a **graphical interface** (not a file), enforces via quality gates. Java, JavaScript, TypeScript, Python, C#. Explicit framing: notifications when AI-generated code violates the architecture.
- [SonarQube Server 2026.4](https://www.sonarsource.com/blog/introducing-sonarqube-server-2026-4/) — **2026-07-22**: architecture management comes to Server for the first time at no additional cost, alongside a quality gate calibrated for agent-generated code and supply-chain conditions aimed at agentically pulled packages.

Three problems with the old text: the heading named a **deprecated**
mechanism; "among its newer capabilities" understated a GA-on-both-editions
feature; and the AI-code angle — the sharpest competitive claim against this
project — was missing entirely.

**Change made:** heading retitled to *architecture management*; "What it is"
rewritten with the GA dates and the deprecation noted so a reader is not sent
toward a removed feature; "Use it instead when" now says plainly that this is
the closest architecture overlap on the page. The "Where bce differs"
paragraph was **not** changed — the zero-server-CLI-versus-platform
distinction was re-checked and still holds.

### 4. OPA / conftest — UNCHANGED

- [CNCF project page](https://www.cncf.io/projects/open-policy-agent-opa/) — still Graduated.
- [OPA releases](https://github.com/open-policy-agent/opa/releases) — **v1.19.1, 2026-08-17**. Recent work is engine-level (WASM runtime swap to wazero, a Compile API SQL-injection fix, Rego safety checking).
- [conftest releases](https://github.com/open-policy-agent/conftest/releases) — still under the `open-policy-agent` org, **v0.69.0, 2026-08-03**, repo activity to 2026-08-20. Scope unchanged: structured configuration data.

No move into source-code architecture conformance by either. **No change
made.** (Minor observation, not drift: conftest's release cadence is lumpier
than its stated monthly policy.)

### 5. GitHub spec-kit / Amazon Kiro — UPDATED

- [spec-kit releases](https://github.com/github/spec-kit/releases) — **v1.0.0 and v1.0.1 both 2026-08-21**, after the prior baseline. Multiple releases per week.
- [spec-kit repo](https://github.com/github/spec-kit) — MIT, active. Commands include `constitution`, `specify`, `clarify`, `plan`, `tasks`, `analyze`, `checklist`, `implement`, **`converge`**. `converge` assesses the codebase against spec/plan/tasks and appends remaining work as new tasks — a verification loop, though it generates work rather than blocking a merge.
- [CI Guard](https://speckit-community.github.io/extensions/ci-guard) — a community extension that **does** block merges (`fail_below_threshold`) and emits **percentage scores**. MIT, v1.0.0, last updated around March 2026. Its catalog states it is not hosted, maintained or affiliated with GitHub.
- [Architecture Guard](https://speckit-community.github.io/extensions/architecture-guard) — community, v2.3.6, updated 2026-08-21; detects drift and verifies implementations against rules. Merge-blocking and scoring are not documented.
- [Kiro hooks docs](https://kiro.dev/docs/hooks/) — hooks are session-scoped; `PostFileSave/Create/Delete` are explicitly non-blocking, and the docs state hooks lack integration with Git workflow or repository-platform operations. [Kiro enterprise](https://kiro.dev/enterprise/) — governance is registries and SSO; no CI merge gating.

**The honest finding is uncomfortable and is recorded as such:** the old
"a spec that steers generation has no enforcement power at merge time"
sentence was already imprecise when the page was authored in August. CI Guard
has offered merge-blocking with percentage scores since roughly March 2026.
This is a **baseline research gap, not post-baseline drift** — the original
pass missed it.

What keeps this UPDATED rather than FLAGGED: CI Guard is a single-maintainer
community extension on an explicitly unaffiliated catalog, core spec-kit
still ships no merge gate, and the Kiro half of the claim holds cleanly from
Kiro's own documentation.

**Change made:** the "Where bce differs" paragraph now states the line
honestly — names `converge`, names the community extensions, cites Kiro's own
docs for the hooks limit, and moves the differentiator from *having a gate* to
*what stands behind one*.

**Kiro GA status is secondary-sourced.** Multiple secondary sources place GA
in March 2026 with an international launch in May; no AWS-primary GA
announcement page was reached. The *fact* of GA is well corroborated; treat
the exact date as unconfirmed.

### 6. ESLint boundary plugins — UNCHANGED

- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — MIT, actively maintained, flat config present. No scoring, conformance reports, evidence, baselines or graduated enforcement.
- npm reports **v7.2.0, published around 2026-08-22** — search-index-sourced; a direct npm fetch returned HTTP 403.
- [ESLint version support](https://eslint.org/version-support) — **ESLint 10 is the current line** (released 2026-02-06); **v9 reached end-of-life 2026-08-06**, the same week as the prior baseline. Nothing on the comparison page states a version, so no edit was needed — but any nearby copy saying "ESLint 9+" is now stale.

**UNVERIFIED sub-point:** the published peer-dependency range for ESLint 10
could not be confirmed (npm 403; the repo is now a monorepo whose root has no
`peerDependencies` field and whose per-package path 404'd). Flat-config
support confirmed; explicit ESLint 10 support **not** confirmed.

**No change made** to the entry.

### 7. archgate — UNCHANGED (checked hardest; it is the nearest shipped competitor)

- [archgate/cli](https://github.com/archgate/cli) — Apache-2.0 confirmed. "Enforce Architecture Decision Records as executable rules — for both humans and AI agents."
- [Releases](https://github.com/archgate/cli/releases) — **v0.55.0, 2026-08-22**; v0.54.0 (Aug 19), v0.53.0 (Aug 14), v0.52.0 (Aug 7). Notes cover Bun runtime, TypeScript linting, sandbox-escape hardening, new rules.
- [cli.archgate.dev](https://cli.archgate.dev) and [archgate.dev](https://archgate.dev) — severity levels exist; no score, no evidence or attestation, no baseline or advisory mode, no recall or benchmark language. Free OSS CLI, no hosted tier.
- Holds an [OpenSSF Best Practices passing badge](https://www.bestpractices.dev/en/projects/12659/passing).

The four claimed differentiators, explicitly:

| | Differentiator | archgate today |
|---|---|---|
| a | Numeric conformance score rather than boolean | **Absent** — exit code 1 on violations; severity levels are not a score |
| b | Measured recall / seeded-defect self-validation | **Absent** — no recall, benchmark or seeded-defect language found |
| c | Hash-chained / offline-verifiable evidence | **Absent** — runtime checks only |
| d | Advisory→enforced graduation / baseline burn-down | **Absent** — no baseline, ratchet or warn-only graduation |

**Scope caveat:** README, full release list, docs site and marketing site were
read; the source tree was not. An undocumented internal capability is
theoretically possible, though four surfaces agreeing is strong evidence.

**Change made:** a dated re-check sentence added to the entry, flagging it as
the claim on the page most likely to go stale.

### 8. SGE (Spec Growth Engine) — UNCHANGED (verified against the paper's own text)

- [arXiv:2606.27045](https://arxiv.org/abs/2606.27045) **resolves.** Hartwig Grabowski, cs.SE / cs.AI, submitted 2026-06-25. **v1 only** — `2606.27045v2` returns HTTP 404.
- [Full text](https://arxiv.org/html/2606.27045) states verbatim that SGE "is maintained as an internal design-document set; a public release is planned, and the documents are available from the author on request." The page's wording tracks this closely and is still current.
- Validation is a traced walkthrough (Section 7, growing a checkout flow) — **no** empirical evaluation or comparative study, as the page says.
- The drift gate is a binary block over exactly **four hard-error classes** (orphan code, undeclared dependency, dependency bypasses contract, missing dependency contract) plus three non-blocking warning classes. The page's "binary block over four hard-error classes" is exact.
- Evidence derives from static analysis. No hash-chaining, no runtime observation, no measured recall — confirming all four "properties SGE's design does not specify."

**No public release found since 2026-08-10.** Searches surfaced the arXiv
entry plus one syndicated media pickup dated 2026-08-15 that describes the
paper and announces no release.

**Honest limit:** "no release found" rests on search plus the paper's own
release-status sentence. A quiet repository under an unguessed name could
exist — but the paper's text is affirmative primary evidence about its
current state, which is stronger than search-absence alone.

**Change made:** a dated re-check sentence, attributing the release-status
claim to the paper rather than to this project.

---

## New entrants

**Headline verdict: near neighbours only — no direct competitor launch.** No
tool was found holding the conjunction this project argues for (authored
blueprint **and** fail-closed gating **and** self-measured recall **and**
offline-re-derivable evidence). Two findings are material enough to change
the page.

### Drift — added to the page

[github.com/mick-gsk/drift](https://github.com/mick-gsk/drift), MIT. First
release **v0.9.0, 2026-03-28** — i.e. it *predates* the original baseline and
was simply missed. Detects architectural erosion in AI-generated code across
24 deterministic signals; composite score plus letter grade; `--fail-on` CI
gate. It publishes a **mutation benchmark: 75 of 100 injected defects caught**.

This is the finding that most affected the page. "Measured recall against a
seeded-defect corpus" is no longer unique to this project among open-source
tools, and the closing section's old sentence had to narrow accordingly.

What keeps it a neighbour rather than a competitor, from its own README:
gating is opt-in (the published Action example ships `fail-on: none` with
advice to tighten once you trust the output), the score is self-disclaimed as
"orientation, not a verdict," and there is no authored contract — boundaries
are *observed*, not configured.

**UNVERIFIED:** Drift's `STUDY.md` returned HTTP 404 on the raw path. The
recall figures come from the README and a repo page citing that study, not
from the study itself. Treat as *claims measured recall*, not as *has
verified equivalent recall* — the methodology, defect distribution and
comparability to this project's corpus are unaudited here. The page says so.

### Archfit — added to the page

[github.com/alexei-led/archfit](https://github.com/alexei-led/archfit),
Apache-2.0, Go. Authored `.archfit.yaml` against a published schema, 0–100
scorecard, fail-closed exit codes (0/1/2/3), pitched at AI-agent and CI
workflows with structured repair blocks. v1.1.1 landed 2026-07-01;
**v1.7.0 and v1.7.1 on 2026-08-22/23** — inside the window this pass covers.

The nearest neighbour on the blueprint-plus-score-plus-gate axis, and the
material in-window change. It has no recall self-measurement and no evidence
chain; its content-addressed fact cache is a performance mechanism, not
provenance.

**Reachability note:** the launch article on itnext.io returned HTTP 403. The
repository and release pages were reachable and are what the entry cites.

### Named but not written up as full entries

Listed in the page's closing paragraph, with the reason for the lighter
treatment: each is early, narrow, or not yet clearly in scope, and padding
the page with tangential tools would be its own dishonesty.

| Name | Why it is worth a reader's time | Why not a full entry |
|---|---|---|
| [ArchSteer](https://www.archsteer.com/) | Commercial; trends conformance as a single drift index; dedicated AI-agent-guardrails framing | Gates on net-new violations only; no launch date findable anywhere on the site |
| [ArchRAD](https://github.com/archradhq/arch-deterministic) | The only other tool found with a versioned JSON blueprint plus schema as the authored artifact | v0.1.5, one star; no score |
| [Yarramate](https://github.com/yarrasys/yarramate) | Same authored-contract shape and same agent-drift thesis; qualitative corruption testing | Pre-release; no score, no measured recall |
| [Mestre Yoda](https://github.com/thiagocorreanet/mestre-yoda) | The only tool found emitting SHA-256-digested conformance artifacts described as evidence | Digests are not a chain and are unsigned; not AI-agent-pitched; v0.1.0 |

Checked and excluded as off-axis: Candor, Trestle, Driftwood,
architecture-linter, the UI/style anti-slop tools, agent-drift (goal-drift
stress-testing, not code), Microsoft's agent-governance toolkit (runtime
agent policy), an `architect` Claude Code plugin (LLM-powered analysis),
Loadbearing (pre-alpha, .NET-only), agent-guardrails (gates scope/tests/risk,
not architecture), and an IntentSpec validation action (validates the spec
file's well-formedness, not code conformance). `ArchDrift.com` is a false
positive — an unrelated company sharing the name.

One adjacent research note, not a product: arXiv 2605.01740 describes
conformance-gate decisions carrying signed witness records with a
hash-chained, re-verifiable audit log — the evidence-chain property exists in
the agentic-runtime literature, if not yet in a shipping architecture
conformance CLI.

### Search coverage — and its gaps

Coverage is the part of a re-verify that is easiest to overstate, so it is
written down. Eleven searches plus seventeen page fetches, across: architecture
conformance and drift gates in CI; merge-blocking for AI-generated code; spec
drift and spec–code divergence gates; recent launch surfaces; architecture-as-code
plus conformance scoring; hash-chained attestation for gates; seeded-defect
self-validation of a checker; fitness functions for agents; the npm packaging
angle; and GitHub topic sweeps sorted by recently-updated across
`software-architecture`, `architecture-as-code`, `architecture-as-code-tools`
and `conformance-checking`.

The topic sweeps — not the keyword searches — are what surfaced the entire
late-August cluster and Mestre Yoda. None of those appeared in any keyword
search. That is worth repeating on the next pass.

Gaps, recorded rather than hidden:

- **Two primary sources unreachable** (HTTP 403 and 404 respectively): the Archfit launch article and Drift's study document. Both findings rest on secondary or summary surfaces, as noted per entry.
- **Drift's recall figure is publisher-asserted and unaudited here.**
- **No launch date found for ArchSteer**, the strongest commercial neighbour — no copyright year, changelog or founding date on the site.
- **Topic-tag blindness.** GitHub topic sweeps only see repositories that self-tag. A tool using none of those topics is invisible to this method.
- **Launch surfaces reached indirectly**, through search summaries rather than a direct archive query. A launch post inside the window could have been missed.
- **Adoption floor is very low across the whole cluster** (roughly 0–55 stars). This is an early, fast-moving space; a funded or stealth entrant, a closed beta, or anything announced only in a private community would not appear.
- **English-language search only.**

---

## README-variant decision

**Decision: keep the NORMAL top-section. Do not swap in
`README-contested-variant.md`.** One qualifier below is binding on whoever
finalizes the README.

**The stated swap condition**, verbatim from the variant's own header: swap
"only if the launch-month landscape re-verify … finds that a comparable
architecture-conformance tool for AI-written code **launched first**."

**Why the condition is not met.** The variant exists for a world where
novelty framing would be "both false and weak" — where a reader could point
at one comparable tool and say *that already exists*. No such tool was found:

- **archgate** shipped before the baseline, is already on the page, and lacks all four claimed differentiators. Narrower by design.
- **Archfit** holds the blueprint, the score and the fail-closed gate — but no self-measured recall and no evidence chain.
- **Drift** holds measured recall — but is explicitly not a verdict (`fail-on: none` by default, score disclaimed as orientation) and has no authored contract.
- **SonarQube** enforces architecture and markets it at AI-written code — but as a platform, without self-measured recall or re-derivable evidence.
- **SGE** remains a design proposal with no shipped artifact.

Each holds a *part*. None holds the conjunction, and the conjunction is what
the framing rests on. Swapping to the contested variant on this evidence
would overstate the competitive position in the opposite direction — which is
its own species of inaccuracy.

**The binding qualifier.** The condition for the *variant swap* is not met;
the condition for *unqualified primacy wording* is comfortably gone. With
archgate, Archfit, Drift and SonarQube's architecture management all live, no
first/only/category-ownership framing survives a reader with a search engine
— and it will be a launch-post reader, within the hour.

When this pass began, the README's top section opened "bce is **the**
fail-closed architecture-conformance gate for AI-built systems" — a
category-ownership claim that this landscape no longer supports. A concurrent
README rebuild has since replaced that sentence, and the wording now on the
default branch — "bce is the merge gate that keeps what they write true to
your architecture" — is a **role** description rather than a claim to own the
category. That reads as defensible and no change is asked for.

The constraint is therefore forward-looking, and it is the part to carry into
the flip: **do not reintroduce first / only / definitive / category-ownership
framing** in the README, the launch post, or the comparison page. The
evidence above is what makes such a claim refutable in a single search, and
that evidence is dated — see the re-decide condition below.

This pass deliberately edits no README; the file belongs to that concurrent
rebuild. This section is the evidence its owner needs, not an instruction to
it.

Note that the contested variant is **not** wasted work. Its three-property
argument — measured recall, fail-closed self-hosting, offline-re-derivable
evidence — is exactly the argument that survives contact with this landscape,
and the normal top-section is stronger for borrowing that spine even without
the swap.

**Re-decide if the flip slips.** This decision is dated. Archfit shipped two
releases inside the seventeen-day window this pass covers; Drift predates the
baseline and was still missed once. If the flip lands materially later than
about thirty days from 2026-08-27, run another pass and re-decide rather than
inheriting this verdict. The 60-day automated nudge is a backstop, not a
substitute — it would not have fired before this flip either.

---

## Launch-document reconciliation

`docs/launch/show-hn-draft.md`, checked line by line against the tree.

| Claim | Tree state | Outcome |
|---|---|---|
| "corpus of 34 seeded architecture defects" | `corpus/MANIFEST.json` → `counts.defects: 34` | **Accurate.** Added the paper's frozen-measurement figure (`paperFrozenCorpus: 25`) alongside it, matching how the README states it — a reader who opens the manifest sees both numbers and should not have to reconcile them mid-thread. |
| "the recall grade is a build leg" | `.github/workflows/ci.yml` runs the measured-recall corpus run as a named step in `build-test-prove` | **Accurate.** No change. |
| "a vacuity check (`bce teeth`) that refuses blueprints that cannot fail" | `src/teeth.ts` — the verdict is three-way: `'toothed' \| 'toothless' \| 'evaluator-refutable'`. `toothless` is refused; `evaluator-refutable` keeps the exit-0 class and is explicitly *not* positive evidence | **True but under-described.** The draft implied a boolean. Rewritten to state the three-way verdict, since the middle class is a deliberate honesty mechanism the repo added on purpose, and a reader who opens `teeth.ts` will find it. |
| Pre-post checklist: "All CI legs green on main HEAD (ci, self-gate, leakage, banned-phrase)" | Real job names: `build-test-prove`, `lane-b-self-gate`, `lane-a-pinned-gate`, `leakage-gate`, `banned-phrases` | **Stale — not one of the four matches a job.** (Worse than item 10's old list, which at least had `leakage-gate` right; the draft had shortened it to `leakage`.) This is the identical filename-versus-job-name mistake `public-flip-checklist.md` item 10 already corrects at length; the draft still carried it. **Fixed**, with a pointer to item 10. |
| "the comparison page says when to use those instead" | The page now names two directly overlapping tools | **Thin.** Added one sentence acknowledging the neighbours — the draft should not be the last place a reader learns the field is populated. |
| "Comparison page landscape re-verify done this month" | This pass | **Updated** to name the dated report and the re-run condition. |

**One item outside the declared blast radius was also fixed, deliberately.**
`public-flip-checklist.md` **Phase 0 item 1** carried the same stale
filename list (`ci`, `self-gate`, `banned-phrase-gate`) that item 10 of the
same document corrects. Leaving it would have meant this pass knowingly
shipped a document naming three contexts that match no job in the
repository, two files from where it fixed exactly that. Item 1's version is
much less dangerous than item 10's was — it misleads a checker rather than
wedging `main` — but it is the same defect and the fix is one line. It is
called out here and in the pull request rather than folded in silently.

---

## What the next pass should do differently

1. **Run the GitHub topic sweeps first.** They found the entire late-August cluster; keyword searches found none of it.
2. **Re-check archgate, Archfit and Drift by name** — the three shipped neighbours whose feature sets could most cheaply absorb a claimed differentiator.
3. **Retry the two unreachable sources** (Drift's study document, the Archfit launch article) and downgrade or confirm the figures that currently rest on secondary surfaces.
4. **Re-read the closing section's conjunction** as the actual claim under test. It is now the page's load-bearing sentence, and it is a claim about a *search*, not about the world.
5. **Extend this file rather than replacing it.** The value of a dated pass is the series.
