# Landscape re-verify — 2026-11-08

The second dated pass behind `docs/comparison.md`. It extends
[landscape-reverify-2026-08-27.md](landscape-reverify-2026-08-27.md) and does
not replace it. Read that file for the method, the first per-entry evidence
and the original README-variant reasoning.

The pass was prompted by the automated nudge. Issue #139, filed 2026-11-03 by
`.github/workflows/landscape-reverify.yml`, reported the baseline at 68 days
old against a 60-day budget.

**Method.** An AI agent ran it from the maintainer's account; it was not
reviewed independently. Three parallel web passes ran. Two re-verified the
entries already on the page against their current primary sources. The third
searched for new entrants, running the GitHub topic sweeps first as the
previous pass recommended. The agent then checked the load-bearing claims
directly:

- every release version and date below, against the GitHub releases API;
- the SGE version history, against arXiv;
- the Kiro hooks page;
- the AsDecided governance and benchmark pages;
- the Archfit README;
- the Drift study document.

Release dates come from `api.github.com/repos/<repo>/releases`, the first
non-prerelease entry. They do not come from rendered release pages, because
one summarizer misread the year on two of those. A source that could not be
reached is recorded as UNVERIFIED.

---

## Per-entry verdicts

All checked **2026-11-08**.

| # | Entry | Verdict | What moved since 2026-08-27 |
|---|---|---|---|
| 1 | ArchUnit (and ts-arch) | **UPDATED** | ArchUnit v1.5.1 (2026-09-25). This was a fix-only release. |
| 2 | dependency-cruiser | **UNCHANGED** (text) | v18.7.2 (2026-11-02). Its known-violations baseline matured. The category is unchanged. |
| 3 | SonarQube | **UPDATED** | Server 2026.5 LTA (2026-09-29) adds cross-project architecture management in beta. |
| 4 | OPA / conftest | **UNCHANGED** | Versions moved only. |
| 5 | GitHub spec-kit / Amazon Kiro | **FLAGGED** | The Kiro sentence the page cited is no longer on Kiro's hooks page. |
| 6 | ESLint boundary plugins | **UNCHANGED** | v7.4.2 (2026-11-05). ESLint 10 support is still unconfirmed. |
| 7 | archgate | **UPDATED** (differentiators hold, one with a nuance) | v0.61.0 (2026-10-28) and a new tagline. Warning severities plus a global `--strict` switch predate the last pass. |
| 8 | Drift | **UPDATED** | No new release. The study document was found. Its figures disagree with the README. |
| 9 | Archfit | **FLAGGED** | v2.0.0 dropped the repository scalar score. v3 added baselines that accept no new debt, and ratchets. |
| 10 | SGE | **FLAGGED** | arXiv v2 (2026-10-09), a public Apache-2.0 repository, and an implementation paper. |

### 1. ArchUnit (and ts-arch) — UPDATED

- [ArchUnit releases](https://github.com/TNG/ArchUnit/releases): the latest is **v1.5.1, 2026-09-25**, a fix-only release. There is still no CLI, scoring, merge-gate product or evidence output.
- [ts-arch releases](https://github.com/ts-arch/ts-arch/releases): still **v5.4.1, 2024-12-23**. The repository is not archived.
- [ArchUnitTS releases](https://github.com/LukasNiessen/ArchUnitTS/releases): **v2.5.4, 2026-09-13**. It is still a test library. Its metrics are threshold assertions, and it has no gate of its own.

**Change made:** the ArchUnit release reference now names v1.5.1.

### 2. dependency-cruiser — UNCHANGED

- [Releases](https://github.com/sverweij/dependency-cruiser/releases): **v18.7.2, 2026-11-02**.
- v18.3.0 (2026-09-13) added a `--baseline` CLI option with shrink-only updates.
- v18.4.0 (2026-09-20) can exit non-zero on stale baseline entries.
- That gives it a shrink-only known-violations baseline, which overlaps bce's brownfield mechanism. It still has no score and no evidence output.

The page's "Where bce differs" paragraph lists shrink-only baselines as part of
bce's machinery. It does not claim dependency-cruiser lacks one, so it stays
accurate. **No change made.** The next pass should re-read this entry if the
baseline feature keeps growing.

### 3. SonarQube — UPDATED

- [Cloud GA blog](https://www.sonarsource.com/blog/code-architecture-management-general-availability-in-sonarqube/) and [Server 2026.4 blog](https://www.sonarsource.com/blog/introducing-sonarqube-server-2026-4/) both still resolve and still say what the page cites.
- [Server 2026.5 LTA](https://www.sonarsource.com/products/sonarqube/whats-new/2026-5/), announced 2026-09-29, adds **cross-project architecture management, in beta**.
- [Current docs](https://docs.sonarsource.com/sonarqube-server/architecture-analysis/project-architecture) still describe a UI editor for the intended architecture. They describe no file-based definition, score or evidence feature.
- The [Cloud deprecations page](https://docs.sonarsource.com/sonarqube-cloud/deprecations-and-removals/) still says the old design-and-architecture features will be removed after 2026-01-17. Whether they were actually removed is **UNVERIFIED**. The only evidence is that the old Server docs page exists for 2025.6 and returns 404 for 2026.1 and later.

- The [Server release notes](https://docs.sonarsource.com/sonarqube-server/server-update-and-maintenance/release-notes) name that feature "Organization-wide architecture analysis (beta)", in Enterprise and Data Center editions. Deviations from the intended architecture are raised "as standard issues", so they enforce through ordinary quality-gate issue conditions, not a dedicated conformance score.
- The Cloud deprecations page also lists "Replacement of Sonar way for AI code quality gate". Only the heading was read, so what replaced it, and when, is **UNVERIFIED**. The page's "quality gate calibrated for agent-generated changes" is still backed by the Server 2026.4 blog ("Sonar way for Agentic AI"). The next pass should re-check the Cloud wording.

**Change made:** one clause names the 2026.5 cross-project beta. The page
still describes removal as announced, not as done.

### 4. OPA / conftest — UNCHANGED

- [OPA](https://github.com/open-policy-agent/opa/releases) **v1.22.2, 2026-11-06**. [conftest](https://github.com/open-policy-agent/conftest/releases) **v0.71.1, 2026-10-06**.
- Neither moved toward source-code architecture conformance.
- CNCF graduated status was not re-checked. It is UNVERIFIED this pass and unchanged on the page, which never stated it.

### 5. GitHub spec-kit / Amazon Kiro — FLAGGED (Kiro half)

- [spec-kit releases](https://github.com/github/spec-kit/releases): **v1.3.2, 2026-11-06**.
- The [`converge` template](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/converge.md) still appends remaining work as new tasks.
- spec-kit still ships no first-party merge gate. Its workflow `gate` step is an interactive human approve or reject. A built-in `github` step (PR #4905) only adds labels.
- [CI Guard](https://speckit-community.github.io/extensions/ci-guard) and [Architecture Guard](https://speckit-community.github.io/extensions/architecture-guard) both still exist on a catalog that states it is unaffiliated with GitHub.
- **Kiro.** The [hooks page](https://kiro.dev/docs/hooks/) no longer contains the sentence the page quoted, that hooks lack integration with Git workflow or repository-platform operations. The agent fetched the page itself and confirmed the sentence is gone.
  - The page now lists "Validate before commit — check code quality before the agent finalizes changes". Its triggers are still agent-session events.
  - Kiro CLI has a [headless mode](https://kiro.dev/blog/introducing-headless-mode/) for CI.
  - An [AWS DevOps blog post](https://aws.amazon.com/blogs/devops/accelerating-development-workflows-with-kiro-cli-as-a-pre-commit-and-git-hook-agent/) dated 2026-09-29 shows Kiro CLI inside Git pre-commit and pre-push hooks that abort on a non-zero exit. That is a documented pattern built from user scripts, not a native merge gate.

**Why FLAGGED.** The page cited a primary source for a limitation, and that
source no longer says it. The finding is not that Kiro now gates merges. The
finding is that the old citation is dead and the honest line has moved.

**Change made:** the Kiro sentence now says what the current docs and the AWS
post show. Kiro has no built-in merge gate, but its CLI can be scripted into
commit hooks and CI.

**Kiro GA date, corrected.** The previous pass placed GA in March 2026 from
secondary sources only. An AWS-primary source has now been reached: the
[AWS weekly roundup of 2025-11-24](https://aws.amazon.com/blogs/aws/aws-weekly-roundup-kiro-ga-road-to-reinvent-launches-and-join-the-event-virtually-nov-24-2025/)
says Kiro "became generally available". The comparison page never stated a GA
date, so nothing on it changes.

### 6. ESLint boundary plugins — UNCHANGED

- [eslint-plugin-boundaries releases](https://github.com/javierbrea/eslint-plugin-boundaries/releases): **v7.4.2, 2026-11-05**. Its project site now lists Oxlint alongside ESLint 9.
- **Still UNVERIFIED:** explicit ESLint 10 support.
  - The [npm peer range](https://registry.npmjs.org/eslint-plugin-boundaries/latest) `eslint >=6.0.0` allows it.
  - The repository develops and tests against ESLint 9.39.
  - The project site says "ESLint 9".

### 7. archgate — UPDATED (differentiators re-checked)

- [Releases](https://github.com/archgate/cli/releases): **v0.61.0, 2026-10-28**. The work since v0.55.0 includes auth, a Codex plugin, new lint rules and an Intel macOS binary. None of it touches scoring, recall, evidence or baselines.
- The tagline on the [README / docs site](https://cli.archgate.dev/) is now "Enterprise-grade linting and guardrails for AI work". The page does not quote a tagline.
- Its [ROADMAP](https://github.com/archgate/cli/blob/main/ROADMAP.md) lists a governance score as "Designed; not yet built".

| | Differentiator | archgate on 2026-11-08 |
|---|---|---|
| a | Numeric conformance score | **Absent.** Exit 0/1. A governance score is on the roadmap but not built. |
| b | Measured recall / seeded-defect self-validation | **Absent** |
| c | Hash-chained / offline-verifiable evidence | **Absent for check results.** SLSA provenance and Sigstore signatures cover release binaries only. |
| d | Advisory→enforced graduation | **Partial, and it predates the last pass.** [ARCH-026](https://github.com/archgate/cli/blob/main/.archgate/adrs/ARCH-026-strict-mode-and-check-severity-tiers.md), shipped in 0.52.0 (2026-07-27), adds error, warning and info severities plus one global `--strict` switch that can be persisted. There is no per-rule graduation and no baseline. |

Row d is a **correction to the previous pass**, which recorded it as absent.
The page's wording is "one-way advisory→enforced graduation for brownfield
adoption". bce's graduation is per blueprint, one-way and paired with a
shrink-only baseline, and that distinction still holds. A reader who finds
`--strict` should not conclude that the page denied archgate has any advisory
mode, though.

**Change made:** the archgate re-check paragraph is re-dated, and it names the
severity and `--strict` nuance.

### 8. Drift — UPDATED

- [github.com/mick-gsk/drift](https://github.com/mick-gsk/drift): no release since **v2.51.1, 2026-05-04**.
- README facts re-confirmed: 24 signals, a composite score with letter grade, `--fail-on`, an Action example with `fail-on: none`, "orientation, not a verdict", and boundaries observed, not configured.
- **The study document was found.** The previous pass tried the repository root path, which still returns 404. The README links to [docs/STUDY.md](https://github.com/mick-gsk/drift/blob/main/docs/STUDY.md), which resolves. The agent read it directly.
  - The v0.5 mutation benchmark detected 12 of 14 (86%).
  - The v2.7 harness detected 25 of 25.
  - The study says those figures "still correspond to the earlier v2.7 baseline model" and were not revalidated for the current signal set.
- The README's "75 of 100" figure is a different number. Per the search pass, the README's benchmark file labels it a bootstrap baseline. The agent did not open that file itself.

**Change made:** the page no longer says the study was unreachable. It now
states that the publisher's figures disagree with each other and predate the
current model. The point that matters is unchanged: Drift publishes
self-measurement, and this project has not audited it.

### 9. Archfit — FLAGGED

- [Releases](https://github.com/alexei-led/archfit/releases): **v2.0.0, 2026-08-27**, replaced the repository-level scalar score with a multi-dimension, evidence-aware architecture state. **v3.4.0, 2026-10-28**, is the latest. The [README](https://github.com/alexei-led/archfit) now says it "does not reduce the repository to one score". Balanced Coupling is still scored per edge or seam.
- Per its [configuration docs](https://github.com/alexei-led/archfit/blob/main/docs/configuration.md):
  - Each gate is `off`, `warn` or `fail`.
  - Metrics ratchet against a stored baseline.
  - `archfit baseline --reanchor` carries accepted debt forward without accepting new findings.
  - A branch cannot grade itself under policy it changed.

  Those are advisory→enforced and baseline mechanics close to bce's.
- Still absent: seeded-defect recall measurement of its own checker, and evidence a third party can re-derive. Its [evidence docs](https://github.com/alexei-led/archfit/blob/main/docs/evidence.md) call reports "self-reported/customer-attested".
- The launch article on itnext.io and its medium.com alias still return **HTTP 403**. They are UNVERIFIED and only a summary was seen.

**Why FLAGGED.** The page described Archfit by a 0–100 scorecard it no longer
has. Its gating and debt mechanics also grew toward bce's.

**Change made:** the entry was rewritten from current sources. The narrow
differentiators it names, self-measured recall and an offline-re-derivable
evidence chain, were re-checked and still hold.

### 10. SGE (Spec Growth Engine) — FLAGGED

- [arXiv:2606.27045](https://arxiv.org/abs/2606.27045): **v2 posted 2026-10-09**. The comments field now reads "Code: https://github.com/grabow/spec-growth-engine. Implementation: arXiv:2610.11725".
- [github.com/grabow/spec-growth-engine](https://github.com/grabow/spec-growth-engine): Apache-2.0, created 2026-10-08, last push 2026-10-25, no releases or tags.
- Companion paper [arXiv:2610.11725](https://arxiv.org/abs/2610.11725), submitted 2026-10-08, describes the implementation.
- The search pass found per-change truncated SHA-256 fingerprints described in-source as "a local record, not a signature", and no recall measurement. Its GitHub code search was then rate-limited, so whether SGE has any numeric score is **UNVERIFIED**.

**Why FLAGGED.** The page described SGE as "a design, not yet a released tool"
and quoted the v1 paper's "public release is planned". That is no longer the
paper's text.

**Change made:** the entry now says SGE has public code with no tagged release
yet. The differentiators it claims for bce are narrowed to what was checked.

---

## New entrants

**Headline verdict: near neighbours only, and no tool holds the conjunction.**
The conjunction is an authored blueprint contract, fail-closed gating,
self-measured recall of the checker, and evidence a third party can re-derive
offline. No tool found holds all four. One new finding comes closer than any
tool on the page so far.

### AsDecided — added to the page as a full entry

- [github.com/asdecided/core](https://github.com/asdecided/core): Apache-2.0, Rust.
  - **v0.1.0, 2026-06-01.** That is before bce's first public release (v0.1.0, 2026-09-01). The previous pass missed it.
  - Latest **v0.31.2, 2026-10-05**.
  - About 300 stars on 2026-11-08.
- It stores engineering decisions as typed Markdown records with a published spec, and serves them read-only to agents over MCP.
- `decided gate --code --base <ref>` gates code against those decisions. This is the "Sentry" enforcement layer, which the search pass dated to v0.26.0 (2026-07-30).
- Per its [governance docs](https://asdecided.com/docs/vendor/core/governance/):
  - `advisory` findings annotate but do not fail, and `blocking` findings fail the gate.
  - Teams can start broad-advisory on a legacy corpus "then move codes back to `blocking` one at a time".
  - Output is SARIF. The docs mention no signing, hashing or attestation chain, and no numeric score.
- [SentryBench](https://github.com/asdecided/benchmarks) is a benchmark of its own enforcement checker. Its stated dimensions include recall, and it covers 80 contract cases.
  - The search pass reported that 38 of the 80 cases are seeded violations. The agent confirmed the 80 cases and the recall dimension directly, but not the 38.
  - No headline recall figure was read on the benchmark page.

What it holds:

- an authored contract, in the form of decision records rather than a whole-architecture blueprint;
- a blocking gate with advisory→blocking graduation;
- a published self-benchmark that includes recall.

What it lacks: evidence a third party can re-derive offline, and a conformance
score.

### SlideRule and easement — named in the closing paragraph

- **SlideRule** ([github.com/andypgray/sliderule](https://github.com/andypgray/sliderule)): MIT, .NET.
  - **v0.1.0, 2026-10-09**; latest **v0.3.0, 2026-11-04**.
  - The search pass reported a single C# architecture spec and a gate via CLI, CI, xUnit and a Claude Code Stop hook. It also reported a `Migrate` ratchet over a counted baseline, shrunk by `accept-reductions` and then promoted to `Enforce`, which is close to bce's graduation model.
  - No recall or evidence was found. These are search-pass findings and were not re-fetched by the agent.
- **easement** ([github.com/mokevnin/easement](https://github.com/mokevnin/easement)): MIT.
  - **v0.1.0, 2026-10-25**; latest **v0.6.0, 2026-11-08**.
  - The search pass reported a versioned `easement.yml` with a published schema, exit 1 on violation and 2 on error, a baseline plus PR-diff mode, and polyglot coverage via SCIP indexers.
  - No recall, evidence or score was found. These are search-pass findings.

The search pass recommended full entries for both. They are named rather than
written up because each is weeks old, and the agent did not fetch their primary
sources itself. A full entry is a candidate for the next pass.

### Lighter mentions already on the page — re-checked

| Name | 2026-08-27 text | 2026-11-08 finding |
|---|---|---|
| ArchSteer | "commercial; drift index; gates on net-new violations" | **Corrected.** An MIT open-source CLI ([source](https://github.com/einvoice-dev1/archsteer); [PyPI](https://pypi.org/pypi/archsteer/json) 0.6.0 2026-07-18 to 0.10.0 2026-07-30) plus a paid team tier. It has a per-rule conformance percentage and a debt baseline with a net-new gate. Search-pass finding. |
| ArchRAD | v0.1.5 | **v0.7.2, 2026-09-02.** It gained a drift-validation command and CI-blocking flags. The README badge says Apache-2.0; the GitHub API reports NOASSERTION. |
| Yarramate | pre-release | **v1.0.0, 2026-08-24; v1.41.1, 2026-09-23.** Its README still calls itself pre-release. It benchmarks its own claims, but against agent behaviour, not checker recall. |
| Mestre Yoda | v0.1.0 | Unchanged (v0.1.0, 2026-08-15). |

### Checked and named as off-axis or adjacent

- **OMEGA Release Gate** ([repo](https://github.com/Lumen-Founder/omega-release-gate), MIT, v0.1.0 2026-11-07) holds three of the four properties in a *neighbouring* problem. It has a fail-closed gate, measured recall on 48 blind agent-written cases, and signed in-toto receipts. Its subject is test weakening, not architecture. It is the first tool seen with signed, re-derivable gate evidence, so it is worth watching.
- **archwhere** has a hash-chained agent-coordination log, not conformance evidence. **karajan-code** has a hash-chained decision log, but its rules are about process, not architecture.
- **living-architecture**, **Architecture Check (EnWithAI)** and **shamash** gate against a model or rules. None measures its own recall or carries evidence.
- Many boundary linters, context or MCP tools and LLM-review products were excluded, as the search pass listed: arch-guard, smelt, maat, railing, Qodo Rules, CodeRabbit guidelines, Copilot code review and others.
- **Name collision:** `quokkify/archgate` is an unrelated Java build gate. It is not the archgate on the page.
- **Supporting evidence, not a tool:** [agents-vs-gates](https://github.com/aderegil/agents-vs-gates) is a preregistered study of 1,187 agent runs. It reports that CI caught every first break and a spec-only rule did not.

### Search coverage — and its gaps

**What was swept.** GitHub topic pages, sorted by recently updated, for nine
topics: software-architecture, architecture-as-code, architecture-as-code-tools,
conformance-checking, architecture-drift, fitness-functions,
architecture-testing, ai-code-review and agent-guardrails. The same topics were
queried through the GitHub search API for repositories created after
2026-08-26, which returned 215 rows. About 26 candidates got a README and
repository-tree scan.

**Keyword searches** covered:

- conformance and drift gates;
- seeded-violation recall;
- hash-chained conformance;
- MCP rule enforcement;
- Show HN and Product Hunt for September to November;
- vendor tooling from Sonar, CodeRabbit, Qodo, Copilot, JetBrains, Snyk, Augment and Factory.

Gaps:

- **GitHub code search was rate-limited (HTTP 403)** after the first query. "No recall measurement" for the newer tools rests on README and tree-path scans, not full-text search.
- **Unreachable:** the Archfit launch article (HTTP 403, again), an IndieHackers post (HTTP 403), and the ArchSteer PyPI HTML page (it did not render; the JSON API worked).
- **Second-hand findings:** SlideRule, easement, ArchSteer and the OMEGA details come from the search pass and were not re-fetched by the agent.
- **Not searched:** Hacker News was not queried through its search API. Product Hunt dates are relative.
- **English-language search only.** Non-English repositories were judged from their descriptions.
- **Topic-tag blindness** persists. A tool using none of the swept topics is invisible to the main method; the earlier pass missed AsDecided, which predates it.

---

## README-variant decision

**Agent recommendation: keep the NORMAL top-section.** The swap condition is a
comparable architecture-conformance tool for AI-written code that **launched
first**. Because this pass found such a candidate, the decision is
**escalated to the maintainer** rather than settled here.

**The candidate.** AsDecided shipped v0.1.0 on 2026-06-01. Its code gate is
dated to v0.26.0, 2026-07-30. Both are before bce's first public release on
2026-09-01. It is pitched at agents, gates code against authored records, and
publishes a self-benchmark that includes recall.

**Why the recommendation is still "normal".**

- Its authored artifact is a set of decision records with pattern and import constraints, not an architecture blueprint graded as a whole.
- It emits no conformance score.
- It produces no evidence a third party can re-derive offline.

The conjunction the README's framing rests on is still not held by any tool
found.

**Why it is escalated anyway.** The 2026-08-27 pass could say no candidate came
close. This pass cannot. Whether a decision-record gate with a recall benchmark
counts as "comparable" is a judgement about positioning. It is not a fact an
agent can verify, and it belongs to the maintainer.

**The binding qualifier from the last pass still holds, and is stronger now:**
no first / only / category-ownership framing anywhere.

---

## Page changes made by this pass

`docs/comparison.md` was changed in these places only:

- the header date and the pointer to this report;
- ArchUnit's version;
- SonarQube's 2026.5 clause;
- the Kiro sentence;
- the archgate re-check paragraph;
- the Drift study sentence;
- the Archfit and SGE entries;
- a new AsDecided entry;
- the closing section, where Drift is no longer "the one" self-measuring tool, AsDecided and the new names are added, and the ArchSteer description is corrected.

The other entries were re-checked and left as they were.

## What the next pass should do differently

1. **Re-check AsDecided, Archfit and archgate by name first.** AsDecided is the closest neighbour. Archfit's debt mechanics are growing toward bce's. archgate has a governance score on its roadmap.
2. **Fetch the primary sources for SlideRule and easement** and decide on full entries.
3. **Watch OMEGA Release Gate.** Signed, re-derivable gate evidence now exists in a neighbouring problem. It is the most likely way the "evidence" leg of the conjunction gets taken.
4. **Look past topic tags.** The earlier pass missed AsDecided despite its topic sweeps. Add a package-registry sweep (crates.io, npm, PyPI, NuGet) for "decision", "architecture" and "conformance" in descriptions.
5. **Extend this series rather than replacing it.**
