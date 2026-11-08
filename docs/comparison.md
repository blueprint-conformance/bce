<!--
  Landscape baseline: authored 2026-11-08 by a web re-verify pass over each
  project's current published documentation, plus a search for new AI-agent
  architecture-conformance tools. Extends the 2026-08-27 pass, which superseded
  the 2026-08-06 original (written from maintainer knowledge) and its
  2026-08-10 extension (archgate, SGE).

  Per-entry verdicts, source URLs, coverage and the coverage GAPS of each pass
  are recorded in docs/launch/landscape-reverify-2026-11-08.md and, before it,
  docs/launch/landscape-reverify-2026-08-27.md — read them before trusting any
  claim on this page, and extend the series (do not replace it) on the next
  pass.

  This page's claims are only as fresh as that date. A re-verify is REQUIRED in
  launch month before the page ships publicly (docs/launch/public-flip-checklist.md),
  and .github/workflows/landscape-reverify.yml nudges monthly on a 60-day budget
  thereafter. If a re-verify surfaces a direct competitor that launched first,
  swap the README top-section for docs/launch/README-contested-variant.md per
  the launch plan. The 2026-08-27 pass found no such competitor. The 2026-11-08
  pass found a closer neighbour that shipped earlier (AsDecided) and escalated
  the swap decision to the maintainer, recommending the normal variant — see
  each report's "README-variant decision" section for the reasoning and limits.
-->

# How bce compares

Every tool on this page is good at what it was built for, and for several of
them the honest advice is *use them instead* — or alongside. bce's specific
job is narrow: a **fail-closed merge contract between an authored
architectural blueprint and the code an AI agent (or a human) actually
wrote**, with a measured-recall grade and evidence you can re-derive
offline. Where that is not your problem, one of these tools is probably the
better choice.

## ArchUnit (and ts-arch)

**What it is.** A unit-test library for asserting architecture rules — layer
dependencies, package containment, naming — inside your test suite. Java
originally, and still actively released there
([1.5.1, 2026-09-25](https://github.com/TNG/ArchUnit/releases/tag/v1.5.1)).
The TypeScript story is less settled: [ts-arch](https://github.com/ts-arch/ts-arch)
is the long-standing port but its last functional release was v5.4.1 in
December 2024, and [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS)
is the more recently active alternative. If you are choosing one for a
TypeScript codebase today, check both before committing.

**Use it instead when** your rules are expressible as code-level assertions
and you want them living next to your unit tests with zero new
infrastructure. It is mature, well-documented, and the test-runner
integration is frictionless.

**Where bce differs.** bce's contract is a *data artifact* (a versioned
blueprint JSON with schemas), not test code — it can be authored, reviewed,
and diffed independently of the implementation language, graded for recall
against a seeded-defect corpus, and enforced with one-way
advisory→enforced graduation plus hash-chained evidence records. ArchUnit
asserts; bce grades, gates, and leaves a verifiable trail.

## dependency-cruiser

**What it is.** A JavaScript/TypeScript dependency linter: you write rules
about which modules may depend on which, it validates the import graph and
draws it.

**Use it instead when** your architecture concern is *dependency hygiene* —
forbidden imports, circular dependencies, orphan modules — and you want a
fast linter in the JS ecosystem with excellent visualization.

**Where bce differs.** Dependency rules are one violation class among
several in a bce blueprint (which also carries components, boundaries,
egress and behavior expectations), and bce wraps its verdicts in the
gate/score/evidence machinery: a numeric conformance score, shrink-only
baselines for brownfield adoption, and offline-verifiable evidence chains.
If you only need import rules, dependency-cruiser is lighter and sharper.

## SonarQube (architecture management)

**What it is.** A broad code-quality platform — bugs, vulnerabilities, code
smells, coverage — that made architecture management generally available
during 2026: on SonarQube Cloud in
[March 2026](https://www.sonarsource.com/blog/code-architecture-management-general-availability-in-sonarqube/),
and on SonarQube Server in
[2026.4, July 2026](https://www.sonarsource.com/blog/introducing-sonarqube-server-2026-4/),
at no extra cost, with cross-project architecture management added in beta in
[Server 2026.5 LTA](https://www.sonarsource.com/products/sonarqube/whats-new/2026-5/)
(September 2026). It reverse-engineers your current structure, lets you
formalize the intended architecture through a graphical interface, and
enforces it through its mature quality gate. Sonar markets this at
AI-written code explicitly — notifications when generated code violates the
architecture, plus a quality gate calibrated for agent-generated changes.
Note that the earlier *declarative* "architecture as code" mechanism (a YAML
or JSON file) is not the successor path: it was
[deprecated with removal announced for January 2026](https://docs.sonarsource.com/sonarqube-server/2025.6/design-and-architecture/overview),
to be replaced by the capability above.

**Use it instead when** you want one platform grading overall code quality
across many languages with dashboards, history, and org-wide policy — and
you are willing to run or subscribe to that platform to get it. That breadth
is its point, and of everything on this page its architecture story overlaps
bce's most directly.

**Where bce differs.** bce is a single-purpose, zero-server CLI: the
blueprint is in your repo, the gate runs in CI, and the evidence is a file
anyone can verify with a standalone script — no platform, no account. It
measures one thing (blueprint conformance) and publishes how well it
measures it (the recall corpus is in the tree).

## OPA / conftest (policy engines)

**What it is.** A general-purpose policy engine (Rego) and its
config-testing frontend. Policies over any structured input — Kubernetes
manifests, Terraform plans, JSON of your choosing.

**Use it instead when** your rules target *configuration and infrastructure*
artifacts, or you already run OPA and want one policy language everywhere.
As a general engine it can express nearly anything, including — with the
right input generation — architecture rules.

**Where bce differs.** bce ships the part OPA deliberately leaves to you:
the extraction of architectural facts from source code (the
`RepositoryFacts` seam), a domain schema for blueprints, and a measured
answer to "does this checker actually catch drift?" (the seeded-defect
corpus). A Rego policy is as good as the input you feed it; bce's pipeline
from source tree to verdict is the product.

## GitHub spec-kit / Amazon Kiro (spec-driven development)

**What it is.** Tooling for the *authoring* side of AI-assisted work:
structured specs that steer an agent while it writes code — plans,
requirements, task breakdowns feeding the generation loop.

**Use it instead when** your problem is getting the agent to build the right
thing in the first place. Spec-driven generation and conformance gating are
complementary halves of the same loop.

**Where bce differs.** bce sits on the *verification* side: after the agent
has written whatever it wrote, does the result still honor the
architectural contract? The line is real but it is not clean, and an earlier
version of this page drew it too hard. spec-kit's own `/speckit.converge`
does compare the codebase back against spec, plan and tasks — but it appends
the remaining work as new tasks rather than blocking anything. Kiro's
[hooks](https://kiro.dev/docs/hooks/) fire on agent-session events and Kiro
ships no built-in merge gate, but its CLI runs
[headless in CI](https://kiro.dev/blog/introducing-headless-mode/) and AWS
[documents scripting it](https://aws.amazon.com/blogs/devops/accelerating-development-workflows-with-kiro-cli-as-a-pre-commit-and-git-hook-agent/)
into Git pre-commit and pre-push hooks that abort on failure — so a Kiro user
can build a commit-time check, though not from a declared architecture
contract. Merge-time enforcement does exist in the spec-kit
ecosystem, as third-party community extensions rather than a first-party
gate — [CI Guard](https://speckit-community.github.io/extensions/ci-guard)
blocks merges on a percentage threshold, and
[Architecture Guard](https://speckit-community.github.io/extensions/architecture-guard)
checks implementations against declared rules; both live on a catalog that
states it is unaffiliated with GitHub. What bce offers against those is not
the existence of a gate but what stands behind one: a measured answer to
"does this checker actually catch drift?", and evidence a reader can
re-derive without trusting the tool. Using a spec-driven tool to write and
bce to gate remains a coherent stack.

## ESLint boundary plugins (eslint-plugin-boundaries and kin)

**What it is.** Lint rules enforcing module/layer boundaries inside the
ESLint toolchain you already run.

**Use it instead when** you want boundary enforcement with zero new tools
and your team already treats ESLint as blocking.

**Where bce differs.** Same shape as dependency-cruiser: linting one
violation class versus a scored, evidenced, graduated contract over
several. The two compose — lint for instant editor feedback, bce as the
merge gate.

## archgate

**What it is.** An Apache-2.0 open-source architecture drift gate: you
declare architecture rules, it checks the codebase against them and blocks
the merge on violation. It ships today, and it claims the
drift-as-a-merge-gate concept from the open-source direction.

**Use it instead when** you want a lightweight, open-source merge-blocking
drift gate with minimal ceremony, and a boolean pass/fail on declared rules
is all your workflow needs.

**Where bce differs.** bce adds the grading and trust machinery around the
gate: a numeric conformance score rather than a boolean, measured-recall
validation of the checker itself against a seeded-defect corpus,
hash-chained evidence you can re-derive offline, and one-way
advisory→enforced graduation for brownfield adoption. archgate asserts and
blocks; bce grades, gates, and leaves a verifiable trail.

Those four differentiators were re-checked against archgate's repository,
release notes, roadmap and docs site on 2026-11-08 and still hold, with one
nuance — archgate is releasing quickly
([v0.61.0, 2026-10-28](https://github.com/archgate/cli/releases)) along the
rule-enforcement axis. Its rules carry error/warning/info severities and a
single repository-wide `--strict` switch escalates warnings to failures, so it
does have an advisory tier; what it lacks is per-contract one-way graduation
paired with a shrink-only baseline. A governance score is on its
[roadmap](https://github.com/archgate/cli/blob/main/ROADMAP.md) as designed but
not built; there is still no self-measurement of the checker and no evidence
output for check results. This paragraph is a claim about another project and
therefore the one on this page most likely to go stale; it is checked on
every re-verify pass.

## Drift

**What it is.** An [MIT-licensed CLI](https://github.com/mick-gsk/drift) that
detects architectural erosion in AI-generated code, aimed by name at
Cursor/Copilot/Claude Code workflows. It scores a codebase over 24
deterministic signals, produces a composite score and letter grade, and can
gate CI through `--fail-on`. It was first released 2026-03-28 — before this
page's original baseline, which simply missed it.

**Use it instead when** you want an architectural-erosion signal on an
existing codebase with nothing to author first. Drift infers boundaries
rather than taking them from you — "boundaries are *observed*, not
configured" — so there is no blueprint to write and no contract to agree on,
which is exactly right when you want a reading rather than a rule.

**Where bce differs.** Two things, and the first matters more than it looks.
Drift is *deliberately not a verdict*: its own documentation calls the score
"orientation, not a verdict," and its published GitHub Action example ships
`fail-on: none`, advising you to tighten it once you trust the output. bce
is fail-closed by construction — the gate's whole purpose is to be the thing
that says no. Second, bce's contract is *authored*: a versioned blueprint
with published schemas, which can be reviewed and diffed as an artifact,
where Drift's inferred boundaries cannot be argued with before the fact.

Drift does, however, publish **measured recall figures for its own
checker** — and it is not alone in that (see AsDecided below). Its README
reports a mutation benchmark of 75 of 100 injected defects caught; its
[study document](https://github.com/mick-gsk/drift/blob/main/docs/STUDY.md)
reports 12 of 14 for an early model and 25 of 25 for a later harness, and
says those figures were not revalidated for the current signal set. The
figures are the publisher's own, on the publisher's own corpora, they do not
agree with one another, and this project has not audited their methodology.
They are cited here because self-measurement is a property bce argues for,
and honesty requires naming other projects that do it rather than implying
nobody does.

## Archfit

**What it is.** An [Apache-2.0 Go CLI](https://github.com/alexei-led/archfit)
in which you author architectural intent as a `.archfit.yaml` against a
published schema and it checks the code against that intent with fail-closed
exit codes (healthy, blocked, needs-attention, error). It is pitched
explicitly at AI-agent and CI workflows, including structured repair blocks
for agents to consume, and it moves fast: v1.1.1 landed 2026-07-01, v2.0.0 on
2026-08-27 replaced the earlier repository-level 0–100 score with a
multi-dimension, evidence-aware architecture state (its README now says it
"does not reduce the repository to one score"; coupling is still scored per
seam), and
[v3.4.0 followed on 2026-10-28](https://github.com/alexei-led/archfit/releases).
Each gate can be `off`, `warn` or `fail`, metrics ratchet against a stored
baseline, and accepted debt can be carried forward without accepting new
findings — adoption mechanics close to bce's own.

**Use it instead when** you want an authored architecture contract with
per-dimension measurement, a blocking exit code and a debt baseline, in a
single Go binary, and you do not need the trust machinery below. On the
authored-contract-plus-gate-plus-graduation axis it is one of the closest
neighbours bce has, and it is a smaller, faster thing to adopt.

**Where bce differs.** Narrowly and specifically: bce measures its own
checker's recall against a seeded-defect corpus that ships in the tree, and
emits hash-chained evidence records a third party can re-derive offline with
no bce install. Archfit does neither (re-checked 2026-11-08) — its
content-addressed fact cache is a performance mechanism, and its own evidence
documentation calls its reports self-reported. If those two properties are not
things you need, Archfit is a reasonable choice and this page would rather
say so than pretend otherwise.

## SGE (Spec Growth Engine)

**What it is.** A 2026 design proposal (Grabowski, arXiv:2606.27045) for a
machine-readable spec graph with contract/design separation, a context
assembler, a vertical-slice growth protocol, and a drift gate that makes
spec–code divergence a blocking merge condition. Until October 2026 it was
an internal design-document set; the
[paper's v2](https://arxiv.org/abs/2606.27045) (2026-10-09) now points to
public Apache-2.0 code at
[grabow/spec-growth-engine](https://github.com/grabow/spec-growth-engine)
and to a companion implementation paper,
[arXiv:2610.11725](https://arxiv.org/abs/2610.11725). As of 2026-11-08 the
repository has no tagged release, and the original write-up remains a traced
walkthrough rather than an evaluation.

**Read it when** you are designing your own intent-gating system: on the
spec-graph and growth-protocol side it is the most complete articulation of
the idea we know of, and it is the nearest neighbor to bce on the
intent-gating axis.

**Where bce differs.** bce is a released realization of the gate with
properties SGE's design does not specify: numeric scoring (the v1 design's
gate is a binary block over four hard-error classes), a hash-chained evidence
chain (SGE's code keeps per-change fingerprints it describes as a local
record, not a signature), served-runtime observation alongside static
analysis, and measured-recall validation of the checker. These were checked
against the design and a read of the new repository, not a full audit of its
code. The two were developed independently — bce's
dated commit history ships with this repository, and the accompanying paper
documents the independence timeline.

## AsDecided

**What it is.** An [Apache-2.0 Rust engine](https://github.com/asdecided/core)
that stores engineering decisions as typed Markdown records in the
repository, serves them read-only to agents over MCP, and gates code against
them (`decided gate --code --base <ref>`, SARIF output). Its
[governance model](https://asdecided.com/docs/vendor/core/governance/) lets a
team start finding codes as `advisory` on a legacy codebase and move them back
to `blocking` one at a time, and it publishes
[SentryBench](https://github.com/asdecided/benchmarks), a benchmark of its own
enforcement checker over 80 contract cases whose stated dimensions include
recall. First released 2026-06-01 — before bce's first public release, and
missed by this page's earlier passes — and at v0.31.2 as of 2026-10-05.

**Use it instead when** the contract you want agents to honor is a set of
engineering *decisions* — conventions, choices, constraints with their
rationale — that agents should retrieve while working and that a gate should
then enforce. That retrieval-plus-enforcement loop around decision records is
its design centre, and bce does not offer it.

**Where bce differs.** As checked on 2026-11-08: bce's contract is an
architecture blueprint graded as a whole, with a numeric conformance score,
where AsDecided gates per finding without a score; and bce emits hash-chained
evidence a third party can re-derive offline, where AsDecided's docs describe
SARIF findings and no signing, hashing or attestation of results. On the
gate, the advisory-to-blocking graduation and the self-benchmark, the two
projects genuinely overlap — of everything on this page it holds the most of
what bce argues for.

## AI-agent architecture-conformance tools

This section used to say that no other open-source tool made bce's specific
claim. The 2026-08-27 re-verify narrowed that and the 2026-11-08 one
narrowed it further, and the narrowing is worth stating plainly: several
projects now hold *parts* of it. AsDecided has authored decision records, a
blocking gate with advisory-to-blocking graduation, and a published
benchmark of its own checker. Archfit has the authored contract, the
fail-closed exit code and a debt baseline. Drift publishes measured recall
figures for its own checker. SonarQube enforces architecture through a
quality gate and markets it at AI-written code. Each of those is a real
overlap, and each is written up above.

What the pass did not find was a tool holding the **conjunction** — an
authored blueprint contract, *and* fail-closed gating, *and* self-measured
recall of the checker, *and* evidence a third party can re-derive offline
without installing the tool. That is a *dated observation about a search,
not a uniqueness claim*: the space is moving quickly, several of these
projects are weeks old, the search ran in English only and can only see
projects that surface to it — it missed AsDecided once — and the coverage
gaps of each pass are written down in
[docs/launch/landscape-reverify-2026-11-08.md](launch/landscape-reverify-2026-11-08.md)
and
[docs/launch/landscape-reverify-2026-08-27.md](launch/landscape-reverify-2026-08-27.md)
rather than left implicit. Read the conjunction as the shape of what bce
argues for, not as a scoreboard.

Also worth a reader's time and not written up above, because they are early,
narrow or not yet clearly in scope: [ArchSteer](https://www.archsteer.com/)
(an MIT CLI plus a paid tier; per-rule conformance percentages and a debt
baseline, gating on net-new violations),
[ArchRAD](https://github.com/archradhq/arch-deterministic) (a versioned JSON
blueprint compiler with a blocking check and drift validation),
[Yarramate](https://github.com/yarrasys/yarramate) (declared-design drift
detection with evidence and attestation records; its README still calls it
pre-release), [Mestre Yoda](https://github.com/thiagocorreanet/mestre-yoda) (a
versioned architecture catalog emitting SHA-256-digested conformance
artifacts), and two that arrived in October 2026:
[SlideRule](https://github.com/andypgray/sliderule) (.NET; an architecture
spec with a counted-baseline ratchet that promotes to enforce) and
[easement](https://github.com/mokevnin/easement) (a schema-backed dependency
contract with baseline and PR-diff modes across languages). If you
maintain a tool that belongs on this page — including one of those, promoted
out of this paragraph into a full entry — please open an issue; we will list
it with the same "use it instead when" honesty as the rest.
