# Public-flip checklist — ordered

The one ceremony that takes this repository from private seed to public
project. Items run in order; each names its actor: **[operator]** (account
authority required — cannot be done from CI or by an agent) or **[agent]**
(scriptable once the operator items before it are done). Sources: the
in-tree headers of `publish-schemas.yml`, `self-gate.yml`, `release.yml`,
`.engine-pin.json`, and `docs/self-hosting.md`.

## Phase 0 — pre-flip gates (repo still private)

1. **[agent]** All required CI contexts green on main HEAD — JOB names, not file names:
   `build-test-prove`, `lane-b-self-gate`, `lane-a-pinned-gate`, `leakage-gate`,
   `banned-phrases`, `launch promises (inert while private, blocking once public)`, and
   `model-evaluation-controller-macos`.
   `gh run list -R blueprint-conformance/bce --branch main --limit 8`

   (This item carried the filename list — `ci`, `self-gate`,
   `banned-phrase-gate` — until 2026-08-27, the same mistake item 10 below
   corrects at length. Harmless here where item 10's version wedges `main`,
   but a checker looking for a job named `ci` finds nothing and has to guess
   what that means. Item 10's table is the reference.)
2. **[agent]** Launch-month landscape re-verify of
   [docs/comparison.md](../comparison.md) (header comment there); decide
   normal vs contested README top-section
   ([README-contested-variant.md](README-contested-variant.md)).
   Last pass: 2026-08-27 —
   [landscape-reverify-2026-08-27.md](landscape-reverify-2026-08-27.md)
   (verdict: normal variant, with a qualifier this item's actor must read).
3. **[operator]** External-witness attestation exists
   ([witness-kit.md](witness-kit.md)) — HARD blocker for the launch post,
   not for the flip itself.
4. **[operator]** Confirm the private paper-artifacts repository referenced
   by [corpus/CORPUS-MAP.md](../../corpus/CORPUS-MAP.md) is reachable for
   referees under this project's org (transfer or mirror it here before the
   paper links go live, so the map's referent resolves).

## Phase 1 — the flip

5. **[operator]** Repo Settings → change visibility to **Public**.
6. **[operator]** Enable secret scanning + push protection (the API call
   that 403s on free-private):
   `gh api -X PATCH repos/blueprint-conformance/bce -f security_and_analysis[secret_scanning][status]=enabled -f security_and_analysis[secret_scanning_push_protection][status]=enabled`
7. **[operator]** Enable org/repo GitHub Pages (source: the branch
   `publish-schemas.yml` targets — see that workflow's header).

## Phase 2 — activation (agent-drivable once 5–7 are done)

8. ~~**[agent]** Activate `.github/workflows/publish-schemas.yml` (remove the
   `if: false` dormancy guard per its header) and run it.~~ **DONE 2026-09-01** —
   Pages enabled (`build_type: workflow`); the guard's paired assertions in
   `docs-site-check.yml` and `tests/docs-site-proof.test.ts` were inverted, not deleted.
9. **[agent]** Verify every schema `$id` resolves 200:
   `for s in spec/schemas/*.schema.json; do curl -fsI "$(jq -r '."$id"' "$s")" >/dev/null && echo "OK $s"; done`
10. **[agent]** Branch protection + required checks on `main`: `build-test-prove`,
    `lane-b-self-gate`, `lane-a-pinned-gate`, `leakage-gate`, `banned-phrases`,
    `launch promises (inert while private, blocking once public)`, and
    `model-evaluation-controller-macos`.
    Lane A is live at the published 0.2.0 pin; this item now concerns required-check enforcement,
    not activation.
    `gh api -X PUT repos/blueprint-conformance/bce/branches/main/protection ...`

    **These are JOB names, not workflow FILE names.** An earlier revision of this
    item listed `self-gate`, `ci`, `banned-phrase-gate` — taken from filenames —
    and **three of those four match no job in this repository**:

    | listed | actual job |
    |---|---|
    | `ci` | `build-test-prove` |
    | `self-gate` | `lane-b-self-gate`, `lane-a-pinned-gate` |
    | `banned-phrase-gate` | `banned-phrases` |
    | `leakage-gate` | correct — the only one that matched |

    Configuring the old list would have **wedged `main` at the flip**: a required
    context that never reports leaves every PR **permanently pending** — not
    failed, *pending*, which no code change resolves and no re-run clears,
    including the PR that would fix it. Nothing enforces that a workflow's file
    name and its job name agree, and four of this repo's seven required contexts differ.

    **Verify before configuring, not after:**

    ```bash
    # run from the steward's governance checkout (the repo holding validate-* scripts)
    bash .claude/scripts/validate-required-context-drift.sh --jobs blueprint-conformance/bce
    bash .claude/scripts/validate-required-context-drift.sh --propose blueprint-conformance/bce \
      build-test-prove lane-b-self-gate lane-a-pinned-gate leakage-gate banned-phrases \
      'launch promises (inert while private, blocking once public)' model-evaluation-controller-macos
    ```

    `--propose` exits non-zero if any proposed context would never report. It
    fails on the old list and passes on this one.

    `witness-kit-freshness` (job `witness kit still matches the engine`) and
    `docs-site-check` (job `the docs site still assembles`) are **path-filtered
    and must NOT be added here** — an earlier revision listed
    `witness-kit-freshness` and was wrong on that too.

    `launch-readiness-gate` (job `launch promises (inert while private, blocking
    once public)`) is **no longer path-filtered** and is therefore requirable —
    see the timing caveat below for *when*. An earlier revision of this item
    grouped it with the two above; #22 (`fix(ci): drop the paths filter so this
    gate can ever become a required check`) removed the filter, and its `on:`
    block now carries a comment naming this checklist item as the reason. Verify
    rather than trust either sentence:
    `sed -n '/^on:/,/^permissions:/p' .github/workflows/launch-readiness-gate.yml`.

    **Every gate on this repository is ADVISORY until this item runs.** Branch
    protection 403s on the free-private plan (`"Upgrade to GitHub Pro or make
    this repository public"`), so nothing has ever blocked a merge here —
    including the leakage gate. This item is what makes any of them real.

    **`launch-readiness-gate` is required LAST — for TIMING, not for filtering.**
    It is inert while private and blocks once public, and at flip time several of
    its promises are legitimately still outstanding (the status line, the badge
    block, the `_placeholder` links). Required *before* those clear, it wedges
    `main` at the worst possible moment — no merge can land, including the merges
    that would clear it.

    > **This item previously gave a second reason — "it is path-filtered on
    > `pull_request`" — and instructed you to drop that filter before requiring
    > the gate. Both were stale.** #22 dropped the filter precisely so this gate
    > could become requirable, and the workflow's `on:` block says so in a
    > comment citing this checklist item. Following the old text would have meant
    > hunting for a filter that is not there and, on not finding it, most likely
    > leaving the gate advisory forever — retiring the one check that exists to
    > enforce the launch promises at the exact moment they come due. Corrected
    > 2026-08-31 (T3 repo readiness). The filtering hazard itself is real and
    > still governs `witness-kit-freshness` and `docs-site-check`.

    Order: flip → clear the promises → confirm green on a PR → then require it.

    `witness-kit-freshness` and `docs-site-check` remain path-filtered, so the
    permanently-pending hazard above applies to them in full: both are better left
    advisory on their schedules than made required with a `paths:` filter in
    place. Either could follow `launch-readiness-gate`'s route — drop the filter,
    then require — but that is a separate change, not a flip-day step.
11. **[agent]** Enable Discussions
    (`gh api -X PATCH repos/blueprint-conformance/bce -F has_discussions=true`)
    and seed: welcome post, "corpus methodology — poke holes here" post,
    Python-extractor interest thread.
12. ~~**[agent]** Activate the README badge block.~~ **DONE** — badges are generated from tree state
    and drift-gated by CI.

## Phase 3 — initial publish (completed historically; operator-attended by design)

13. **[operator]** npm auth: Trusted Publishing entry on npmjs.com for
    `blueprint-conformance/bce` → `release.yml` (preferred, zero tokens) OR
    a granular `NPM_TOKEN` repo secret (see `release.yml` header's honest
    auth note).
14. ~~**[operator]** Remove provisional citation identifiers.~~ **DONE** — `CITATION.cff` is
    software-only and does not invent an arXiv or DOI; the release gate refuses placeholder tokens.
14b. **[agent]** **Enumerate the npm tarball before the tag.** `npm publish` is
    the least reversible step in this ceremony — npm unpublish is restricted
    after 72h, whereas the repo flip (item 5) can be undone. Nobody had ever
    looked inside the tarball before this item existed.

    ```bash
    npm pack --dry-run --json | jq -r '.[0].files[].path' > /tmp/tarball.txt
    wc -l /tmp/tarball.txt          # expect ~125 files (dist, src, fixtures, integrations)
    ```

    Assert, against `/tmp/tarball.txt` and the shipped file contents:

    - **No credential-shaped material.** `ghp_`/`sk_`/`sk-`/`Bearer `, real
      API keys, `.env` files. NOTE: the corpus deliberately ships FAKE ones
      (`fixtures/python-surface/drift-hardcoded-key/service/client.py` carries
      `provider_api_key = "AAAABBBBCCCCDDDDEEEE1234"`, and
      `drift-secrets-file/service/secrets.py` exists precisely so the engine
      can detect it). These are the engine's own test corpus and MUST ship —
      do not "fix" them. Judge on whether a string is a REAL secret, not on
      whether it matches a secret-shaped regex.
    - **No real infrastructure**: no internal hostnames, no IPs, no private
      registry URLs, no customer/tenant identifiers. (`staging.example.com`
      in `fixtures/egress-reader.blueprint.json` is RFC-2606 example space,
      not a real host.)
    - **No file outside the declared `files:` array.** There is no
      `.npmignore`; `files:` is the only allowlist.

    **Known and ACCEPTED — do not scrub:** ~20 shipped fixture paths carry the
    upstream project's internal product vocabulary (`luna-chat.extension.ts`,
    `control-tower-ontology.blueprint.json`). These are deliberately retained.
    `src/corpus.ts` states that every corpus entry "references a REAL fixture
    dir under `fixtures/extension-surface/`" and that "fixtures, constraint
    ids, and severities are the stable join keys to the frozen" measured set —
    so **renaming them perturbs the join keys the paper's recall/false-positive
    numbers are bound to, and dropping `fixtures/` from `files:` disables the
    shipped recall-gate corpus entirely.** Scrubbing a product name is not
    worth invalidating the published measurements. If a future release does
    rename them, the corpus baseline must be re-run and the paper's numbers
    re-bound in the same change.

15. ~~**[operator]** Publish the first tag through `release.yml`.~~ **DONE** — current public release
    is `v0.2.0`, with npm provenance and an immutable canonical GitHub Release. Its asset-ordering
    incident and separate immutable evidence release are recorded in `docs/release-v0.2.0.md`.
16. ~~**[agent]** Verify npm, smoke the packed/published path, and activate Lane A.~~ **DONE** —
    `.engine-pin.json` is live at exact `bce-engine@0.2.0`, and `lane-a-pinned-gate` is required.
17. ~~**[agent]** Replace README placeholder links.~~ **DONE** — guarded by launch-readiness checks.

## Phase 4 — launch post

18. **[operator]** Final pass over
    [show-hn-draft.md](show-hn-draft.md) pre-post checklist; post; arm
    [week-1-triage.md](week-1-triage.md).
