# ALTERNATE README top-section — contested-launch reframe

> **ALTERNATE — swap into README.md only if the launch-month landscape
> re-verify (docs/comparison.md header) finds that a comparable
> architecture-conformance tool for AI-written code launched first.** In
> that world, novelty framing is both false and weak; this variant leans
> entirely on what is *measured and verifiable here*, and names the
> comparable tool honestly. Only the section between the markers replaces
> the README's opening; everything from "The flip" down is unchanged.

---

<!-- BEGIN contested top-section -->

# bce — the blueprint conformance engine

> **Blueprints with Teeth.**

bce is an architecture-conformance gate for AI-built systems: you author a
blueprint (the durable architectural contract for a repository), and bce
measures the code against it — a deterministic conformance score, a
fail-closed merge gate, and hash-chained evidence records anyone can
re-derive offline.

Other tools now work this space too — see
[docs/comparison.md](docs/comparison.md) for an honest map, including when
to use them instead. What this one offers is not primacy but
**verifiability**:

- the engine's recall is *measured*, in CI, against a seeded-defect corpus
  that ships in this repository — you can re-run the grade yourself;
- the gate is *fail-closed and self-hosted* — bce gates its own tree on
  every push under the same verdict its users get;
- the evidence is *re-derivable offline* by a zero-dependency verifier — no
  trust in this project required to check a verdict.

Judge it on those three, side by side with anything comparable. Released extraction is
TypeScript/JavaScript framework AST plus a Python import-surface MVP. The unpublished candidate adds
direct TypeScript/JavaScript and structured Python module graphs; it does not claim Python call,
egress, transitive, or cycle analysis.

<!-- END contested top-section -->
