<!--
  Landscape baseline: authored 2026-08-27 by a web re-verify pass over each
  project's current published documentation, plus a search for new AI-agent
  architecture-conformance tools. Supersedes the 2026-08-06 original (written
  from maintainer knowledge) and its 2026-08-10 extension (archgate, SGE).

  Per-entry verdicts, source URLs, coverage and the coverage GAPS of that pass
  are recorded in docs/launch/landscape-reverify-2026-08-27.md — read it before
  trusting any claim on this page, and extend it (do not replace it) on the
  next pass.

  This page's claims are only as fresh as that date. A re-verify is REQUIRED in
  launch month before the page ships publicly (docs/launch/public-flip-checklist.md),
  and .github/workflows/landscape-reverify.yml nudges monthly on a 60-day budget
  thereafter. If a re-verify surfaces a direct competitor that launched first,
  swap the README top-section for docs/launch/README-contested-variant.md per
  the launch plan. The 2026-08-27 pass found no such competitor — see that
  report's "README-variant decision" section for the reasoning and its limits.
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
([1.5.0, 2026-08-04](https://github.com/TNG/ArchUnit/releases/tag/v1.5.0)).
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
at no extra cost. It reverse-engineers your current structure, lets you
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
the remaining work as new tasks rather than blocking anything, and Kiro's
hooks are session-scoped: its
[own documentation](https://kiro.dev/docs/hooks/) says they lack integration
with Git workflow or repository-platform operations, so they cannot block a
commit, merge or PR. Merge-time enforcement does exist in the spec-kit
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
release notes, docs site and marketing site on 2026-08-27 and all four still
hold — archgate is releasing quickly
([v0.55.0, 2026-08-22](https://github.com/archgate/cli/releases)) but along
the boolean-rule-enforcement axis, not toward scoring, self-measurement,
evidence or graduation. This paragraph is a claim about another project and
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

Drift is, however, the one open-source tool found on this page's re-verify
that also publishes a **measured recall figure for its own checker** — a
mutation benchmark it reports as 75 of 100 injected defects caught. That
number is the publisher's own, on the publisher's own corpus, and this
project has not audited its methodology (the study document was not
reachable at re-verify time — see the report). It is cited here because
self-measurement is a property bce argues for, and honesty requires naming
another project that does it rather than implying nobody does.

## Archfit

**What it is.** An [Apache-2.0 Go CLI](https://github.com/alexei-led/archfit)
in which you author architectural intent as a `.archfit.yaml` against a
published schema, and it scores the code against that intent on a 0–100
"Balanced Coupling" scorecard with fail-closed exit codes. It is pitched
explicitly at AI-agent and CI workflows, including structured repair blocks
for agents to consume. It is the newest arrival on this page: v1.1.1 landed
2026-07-01 and
[v1.7.0/v1.7.1 on 2026-08-22/23](https://github.com/alexei-led/archfit/releases),
inside the window this re-verify covers.

**Use it instead when** you want an authored architecture contract with a
numeric score and a blocking exit code, in a single Go binary, and you do not
need the trust machinery below. On the blueprint-plus-score-plus-gate axis it
is the closest neighbour bce has, and it is a smaller, faster thing to adopt.

**Where bce differs.** Narrowly and specifically: bce measures its own
checker's recall against a seeded-defect corpus that ships in the tree, and
emits hash-chained evidence records a third party can re-derive offline with
no bce install. Archfit does neither — its content-addressed fact cache is a
performance mechanism, not provenance. If those two properties are not
things you need, Archfit is a reasonable choice and this page would rather
say so than pretend otherwise.

## SGE (Spec Growth Engine)

**What it is.** A 2026 design proposal (Grabowski, arXiv:2606.27045) for a
machine-readable spec graph with contract/design separation, a context
assembler, a vertical-slice growth protocol, and a drift gate that makes
spec–code divergence a blocking merge condition. As of the baseline date it
is maintained as an internal design-document set with a public release
planned — a design, not yet a released tool — and its write-up is a traced
walkthrough rather than an evaluation. Re-checked 2026-08-27 against
[the paper's own text](https://arxiv.org/abs/2606.27045): still v1 with no
v2, still no public repository, package or product — the release-status
sentence above is the paper's, not this project's characterization of it.

**Read it when** you are designing your own intent-gating system: on the
spec-graph and growth-protocol side it is the most complete articulation of
the idea we know of, and it is the nearest neighbor to bce on the
intent-gating axis.

**Where bce differs.** bce is a released realization of the gate with
properties SGE's design does not specify: numeric scoring (SGE's gate is a
binary block over four hard-error classes), a hash-chained evidence chain,
served-runtime observation alongside static analysis, and measured-recall
validation of the checker. The two were developed independently — bce's
dated commit history ships with this repository, and the accompanying paper
documents the independence timeline.

## AI-agent architecture-conformance tools

This section used to say that no other open-source tool made bce's specific
claim. The 2026-08-27 re-verify narrowed that, and the narrowing is worth
stating plainly: several projects now hold *parts* of it. Archfit has the
authored blueprint, the numeric score and the fail-closed exit code. Drift
publishes a measured recall figure for its own checker. SonarQube enforces
architecture through a quality gate and markets it at AI-written code. Each
of those is a real overlap, and each is written up above.

What the pass did not find was a tool holding the **conjunction** — an
authored blueprint contract, *and* fail-closed gating, *and* self-measured
recall of the checker, *and* evidence a third party can re-derive offline
without installing the tool. That is a *dated observation about a search,
not a uniqueness claim*: the space is moving quickly, several of these
projects are weeks old, the search ran in English only and can only see
projects that surface to it, and the coverage gaps of that pass are written
down in
[docs/launch/landscape-reverify-2026-08-27.md](launch/landscape-reverify-2026-08-27.md)
rather than left implicit. Read the conjunction as the shape of what bce
argues for, not as a scoreboard.

Also worth a reader's time and not written up above, because they are early,
narrow or not yet clearly in scope: [ArchSteer](https://www.archsteer.com/)
(commercial; trends conformance as a drift index, gates on net-new violations
only), [ArchRAD](https://github.com/archradhq/arch-deterministic) (a versioned
JSON blueprint compiler with a blocking check),
[Yarramate](https://github.com/yarrasys/yarramate) (declared-design drift
detection, pre-release), and
[Mestre Yoda](https://github.com/thiagocorreanet/mestre-yoda) (a versioned
architecture catalog emitting SHA-256-digested conformance artifacts). If you
maintain a tool that belongs on this page — including one of those, promoted
out of this paragraph into a full entry — please open an issue; we will list
it with the same "use it instead when" honesty as the rest.
