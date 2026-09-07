# Quickstart

The guaranteed path to seeing bce work is the offline RED→fix→GREEN walkthrough that ships in this
repository. It runs entirely offline (no API keys, no network beyond one `npm install`), on a tiny
two-tree example, and ends in a real gate failure you fix and re-run to green.

**→ [`examples/quickstart/README.md`](../examples/quickstart/README.md)** — the full walkthrough,
with the example trees checked in beside it.

This page is the one-screen version. The example is one contract and two trees that differ by a single
line:

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="../assets/diagrams/source-to-verdict-mobile.svg">
    <img src="../assets/diagrams/source-to-verdict.svg" alt="BCE reads repository source through a selected extraction profile, records an observed architecture graph and coverage envelope, evaluates the human-owned EngineeringBlueprint, and emits one deterministic compliance report plus exit code 0, 1, or 2.">
  </picture>
</p>

CLI, GitHub Action, and MCP are entry points into this same engine path. The
[C1–C4 visual guide](constraint-guide.md) shows how the first four constraint types interrogate the
observed graph.

```
examples/quickstart/
├── blueprint/no-direct-http-client.blueprint.json   # the contract
├── clean/src/greeting.plugin.ts                     # routes network through the host  → PASS
└── drift/src/greeting.plugin.ts                     # imports axios directly            → RED
```

Check `node --version`: Node 22 or newer is required. Use a fresh directory.
The commands below also work in PowerShell; each is a separate step.
After installation, all BCE operations are local.

```sh
mkdir bce-quickstart
cd bce-quickstart
npm init -y
npm view bce-engine@0.3.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.3.0
node -e "require('node:fs').cpSync('node_modules/bce-engine/examples/quickstart', 'quickstart', {recursive:true})"
```

Validate the contract and prove that the clean tree passes:

```sh
npx --no-install bce validate --blueprint quickstart/blueprint/no-direct-http-client.blueprint.json
npx --no-install bce teeth --blueprint quickstart/blueprint/no-direct-http-client.blueprint.json --ct-repo quickstart/clean --no-pin --extractor ast
npx --no-install bce gate --repo quickstart/clean --blueprint-dir quickstart/blueprint --extractor ast
```

Run the drifted tree separately. Expect exit `1` and an exact forbidden-import diagnosis. This is
an intentional failure; do not join it to the repair step with `&&` or treat it as a failed install.

```sh
npx --no-install bce gate --repo quickstart/drift --blueprint-dir quickstart/blueprint --extractor ast --all
```

Fix the copied source and run the same rule again; expect exit `0`:

```sh
node -e "require('node:fs').copyFileSync('quickstart/clean/src/greeting.plugin.ts', 'quickstart/drift/src/greeting.plugin.ts')"
npx --no-install bce gate --repo quickstart/drift --blueprint-dir quickstart/blueprint --extractor ast
```

No shell alias or global executable is needed. This edits only the disposable copied example,
not the installed package or your repository’s policy.


The exact package above is the provenance-backed public release recorded in
[`STATUS.md`](../STATUS.md). The copy keeps the shipped example writable while the installed
package remains untouched.

A gate that cannot go red is not a gate. This walkthrough proves, on your own machine, that this one
can — and that a green verdict therefore means something.

## Then

- **Choose the boundary that must hold** — [`first-win.md`](first-win.md) runs the six packaged
  recipes in the `v0.3.0` release across extension, route, egress, module, Python, and configuration
  surfaces, then links six measured layout walkthroughs where you author the contract yourself.
- **Gate your own repository** — [`adopt-existing-repo.md`](adopt-existing-repo.md) is the honest
  brownfield path: advisory → baseline → graduate → enforced.
- **Run bce inside an agent loop** — [`agent-loop.md`](agent-loop.md) wires the gate into Claude Code,
  Cursor, or any MCP client as the done-check.
- **Understand the adoption levers** — advisory mode and shrink-only baselines — in
  [`faq.md`](faq.md).
- **Wire the complete stack** — exact package install, contract, agent context, MCP, immutable CI,
  lifecycle, and evidence — in [`onboarding.md`](onboarding.md).

## Recommended next step

- [Ordered onboarding](onboarding.md) — have the current agent draft one real boundary and wire
  advisory CLI, MCP, skills, and CI into your repository.
