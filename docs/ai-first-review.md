# AI-first blueprint proposal and review

`bce propose` is the first repository-facing experience: a maintainer states intent, an AI drafts a
plan, BCE deterministically compiles and tests the exact candidate, and a human reviews one immutable
packet. The model never gains approval or policy-write authority.

## 1. Freeze the state and state the intent

Commit the source state to be reviewed. The authenticated pull-request review must target this exact
commit. Put the architectural intent in a repository text file, then choose exactly one baseline:

```bash
export OPENAI_API_KEY='<credential supplied outside BCE>'

npx --no-install bce propose \
  --repo . \
  --intent-file docs/architecture-intent.md \
  --assistant openai-responses \
  --assistant-model '<exact provider model id>' \
  --new
```

For an existing contract, replace `--new` with `--base <repository-relative-blueprint>`. There is no
moving model default. The initial registry contains only `openai-responses`; arbitrary executables,
URLs, and shell interpolation are not adapters.

## 2. Check the disclosure boundary

Before the fixed `https://api.openai.com/v1/responses` call, BCE prints the exact path, byte count,
and digest manifest that will leave the machine. The context collector includes tracked and
unignored UTF-8 files within its file and byte budgets. It excludes secret-like paths, generated or
vendor trees, binaries, oversized files, symlinks, and anything beyond the context budget, and names
every exclusion class in `disclosure.json`.

Repository text is delimited as untrusted data. It cannot add tools, change the provider endpoint,
or turn model output into policy. The request disables tool use and storage. Credentials remain in
the environment and are not written to the proposal.

## 3. Read the immutable attempt

A successful attempt is written under `.bce/proposals/<proposal-id>/`:

| Artifact | Meaning |
|---|---|
| `context.json` | exact bounded content and repository identity sent for drafting |
| `disclosure.json` | pre-call disclosure manifest |
| `generation.json` | request/model identity, prompt digest, latency, token classes, and honest cost availability |
| `raw-response.txt` | unmodified first provider output or refusal |
| `draft-plan.json` | strictly validated untrusted model plan |
| `<proposal-id>.blueprint.json` | deterministically compiled `draft` candidate |
| `proposal.json` | candidate plus all input and generation digests |
| `review-packet.json` | canonical validation, scope, conformance, teeth, semantic diff, identities, and approval status |
| `review.txt` / `review.html` | human views derived from that same packet |

Provider errors, refusals, malformed plans, stale context, empty scope, and deterministic-processing
failures are retained under `failed-<digest>/`. A failed attempt has no review packet and is never
presented as a blueprint. The quarantine refuses overlap with `.blueprints/`, `.ai/blueprints/`, or
any additional `--governed-dir`; files are created exclusively and never overwritten.

## 4. Review Promise, Lens, Proof, and Limits

```bash
npx --no-install bce review show \
  --repo . \
  --packet .bce/proposals/<id>/review-packet.json \
  --format text

npx --no-install bce review verify \
  --repo . \
  --packet .bce/proposals/<id>/review-packet.json
```

Every clause has four invariant parts:

1. **Promise** states the architectural intent being protected.
2. **Lens** names what the selected extractor and resolved scope actually observe.
3. **Proof** states gradeability and the mutation that makes the clause go RED.
4. **Limits** names unsupported, evaluator-only, toothless, excluded, or ambiguous coverage.

The packet also says whether the candidate tightens, preserves, relaxes, or may relax its selected
base. Unknown policy direction, unsupported grading, toothlessness, and evaluator-only proof block
approval. There is no approve-anyway flag.

The packet also binds the protected-file diff from the pull request's merge base. BCE records the
resolved base branch, that branch's exact head SHA, and the computed merge-base SHA; the GitHub
adapter later requires the selected pull request to report that exact base branch and head. Mutable
environment variables and local remote refs therefore cannot silently change the reviewed diff.
BCE classifies changes to CODEOWNERS, repository agent instructions, workflows, engine pins,
mode/baseline files, skills, schemas, MCP, public exports, review code, extractors, and evaluators. If
it cannot establish all three base bindings, the packet is reviewable but blocked from approval.

## 5. Bind the decision to a real GitHub review

The CLI does not accept reviewer identity, rationale, timestamps, or an assertion digest from local
flags. A reviewer submits a GitHub pull-request review on the packet's exact source commit. The review
body contains these bindings plus a substantive rationale:

```text
BCE-Review-Packet: sha256:<packetDigest>
BCE-Candidate: sha256:<candidateDigest>
BCE-Decision: approve
BCE-Approval-Role: <the packet's single required role>
BCE-Approval-Stage: <the packet's single required stage>

<at least 20 characters explaining what was reviewed and why>
```

For a deterministic relaxation, the approving review must also contain
`BCE-Accept-Weakening: true`. BCE never synthesizes that acknowledgement. The v1 GitHub adapter can
satisfy one declared approval requirement; a packet with multiple requirements is blocked until an
aggregate authenticated-decision flow exists.

Use `request-changes` or `reject` with a GitHub `CHANGES_REQUESTED` review; `approve` requires an
`APPROVED` review. Then resolve that exact forge record:

```bash
export BCE_GITHUB_TOKEN='<token able to read the pull request>'

npx --no-install bce review decide \
  --repo . \
  --packet .bce/proposals/<id>/review-packet.json \
  --decision approve \
  --github-repo owner/repository \
  --github-pull 123 \
  --github-review 456
```

BCE calls only the fixed GitHub API origin, with a ten-second timeout and an incrementally enforced
one-MiB response limit. It requires an open pull request whose base repository, base branch, base
head SHA, head, and selected review commit match the packet, refuses the pull-request author and
Bot/App identities, requires the reviewer's latest state, and rechecks that the reviewer currently
has `maintain` or `admin` repository permission. It derives
the reviewer, rationale, decision time, reference, permission, and assertion digest from those
responses. The resulting file is content-addressed under the canonical proposal `decisions/`
directory. It still does not write policy.

`bce review verify --decision <path>` replays offline integrity and all byte bindings. It does not
claim the forge is still authoritative; ratify and amend re-fetch and reproduce the GitHub decision
immediately before policy mutation.

For a combined human view, pass the same `--decision` to `bce review show`; text and HTML then name
the authenticated reviewer, decision digest, rationale, SCM reference, exact candidate and packet,
and engine identity. `review show` also performs live freshness checks and refuses a stale packet.

## 6. Land through the separate attended ceremony

Ratification promotes an approved reviewed draft; amendment compares the exact current base and
replacement again. Both require the same GitHub selector so the live SCM assertion can be rechecked:

```bash
npx --no-install bce ratify \
  --repo . \
  --blueprint .bce/proposals/<id>/<id>.blueprint.json \
  --packet .bce/proposals/<id>/review-packet.json \
  --decision .bce/proposals/<id>/decisions/approve-<digest>.json \
  --github-repo owner/repository \
  --github-pull 123 \
  --github-review 456
```

Any change to the canonical candidate, tracked source state, ignored non-generated repository bytes,
live extraction, protected-file diff, packet, engine, extractor, toolchain, or SCM review invalidates
landing. Freshness is checked before and after the SCM calls, then once more under the policy
transition lock immediately before the first policy write. The ceremony also requires extractor-real
teeth. Landing uses no-follow file descriptors, digest compare-and-swap checks, a durable transition
lock, durable writes, and rollback on a reported partial failure. Its append-only history records the
packet, decision, candidate/base, repository revision, worktree, and reviewer-authentication digests.

Ratify/amend creates the proposed policy commit; it does not merge or mutate the default branch. That
new commit necessarily differs from the source commit authenticated by the packet decision, so the
repository must dismiss stale approvals and obtain its normal CODEOWNER/required approval on the
final landing commit before merge. The BCE DecisionRecord proves review of the proposal evidence; it
does not pretend to be the final branch-protection approval or make a multi-file filesystem update
crash-atomic. A process crash can leave the durable transition lock behind; while it exists, BCE gate
refuses rather than treating the possibly partial policy state as green. Recovery is an attended
inspection followed by a fresh proposal and review.

## Authority and evidence limits

- The assistant proposes only; it cannot decide, ratify, amend, change mode, grow a baseline, or edit
  workflow and engine pins.
- MCP exposes inspection, explanation, semantic comparison, and packet verification, but remains
  read-only and contains no decision or landing tool.
- A GitHub API lookup authenticates a current human-typed account and current repository permission.
  A declared role/stage is explicitly bound in the review, but the public adapter does not infer
  organization-specific team membership from that label. It does not prove independent review by
  itself or replace CODEOWNERS, required approvals, SSO policy, and merge protection.
- Missing provider model identity, token usage, billing source, or trustworthy cost remains
  `unknown` or `unavailable`; missing telemetry is never rendered as zero.
