# TypeScript module graph — enforce direct architecture boundaries

Use `typescript-module-graph` when the rule is about ordinary TypeScript or JavaScript modules,
not a framework-specific route or plugin shape. Every scanned module becomes a
`typescriptModule` component. Every statically named dependency becomes an `imports` edge before
any policy is applied.

This profile is in the `v0.3.0` source candidate, not the current `v0.2.0` registry release. From a
source checkout, build and run its packaged proof:

```bash
npm ci
npm run build
node dist/cli.js demo --recipe module-layering
```

The clean tree imports from application code into domain code and scores 100. The drift tree adds
one reverse domain-to-application import; C3 names that edge and its source line.

## Fastest agent path: use the existing MCP done-check

This profile does not need a module-specific MCP server or another agent integration. Point the
existing `bce-mcp` stdio server at the target repository, then let the installed BCE skill use its
normal read-only loop:

```text
doctor_repository {}
run_gate {}
```

`run_gate {}` reads the live working tree, including uncommitted fixes. Its structured report names
the same constraint, importer, target, and source line as the CLI; after the source correction, the
same zero-argument call must return `gateFailed: false` and `outcome: "pass"`. MCP cannot author,
approve, weaken, or land policy.

For the source candidate, run the built `dist/mcp-server.js` with the target repository as its
working directory. After the release preflight below resolves, normal `bce onboard` installs the
same Agent Skill, project-local MCP wiring, advisory mode, and immutable CI in one operation:

```bash
npm view bce-engine@0.3.0 version dist.integrity
```

Until that command succeeds, do not pin or onboard the candidate as though it were a registry
release. See [agent-loop.md](agent-loop.md) for client wiring and [onboarding.md](onboarding.md) for
the generated setup path.

## Directional layering

The portable first rule keeps `packages/domain/**` below `packages/app/**`. This is the core fragment
from the [complete executable fixture](../fixtures/typescript-module-layering.blueprint.json):

```json
{
  "minEngineVersion": "0.3.0",
  "constraints": [
    {
      "id": "domain-cannot-import-app",
      "type": "forbiddenDependency",
      "severity": "critical",
      "to": "module:packages/app/**",
      "scopePaths": ["packages/domain/**"]
    }
  ],
  "extraction": {
    "profile": "typescript-module-graph",
    "paths": ["packages/**/*.ts"],
    "minFiles": 2
  }
}
```

`scopePaths` always selects importer modules. `to` selects the dependency target. The profile
requires both fields on C2 and C3 so a stale or accidentally global boundary cannot look green.
It also requires `minEngineVersion >=0.3.0`; an older gate can then say “upgrade” before it tries to
parse candidate vocabulary.

Run the measured [author → RED → fix → GREEN module-layering walkthrough](../examples/first-win/module-layering/README.md)
to create this boundary against a real two-layer tree. The example deliberately includes an
unrelated application module that does not import domain: a directional boundary should not force
every file in a higher layer to depend on the lower one.

## Required edges are narrower

C2 means **every importer in its scope** must carry the named direct edge. Use it only when that is
the actual invariant—for example, one adapter entry point that must delegate to domain:

```json
{
  "id": "checkout-entry-uses-domain",
  "type": "requiredDependency",
  "severity": "high",
  "component": "typescriptModule",
  "to": "module:packages/domain/**",
  "scopePaths": ["packages/app/checkout.ts"]
}
```

## Target selectors

| Selector | Matches | Example |
|---|---|---|
| `module:<repo-path-or-glob>` | a resolved file inside the repository | `module:src/server/**` |
| `package:<npm-root>` | one normalized package root, including all subpath imports | `package:@aws-sdk/client-s3` |
| `builtin:<node-name>` | one Node built-in, with `node:` normalized away | `builtin:fs/promises` |

These selectors support three high-return boundaries:

- Layer direction: domain or shared code cannot import app, UI, or infrastructure modules.
- Runtime separation: browser-facing modules cannot import server-only modules or Node built-ins.
- Choke points: feature modules cannot import database, transport, or provider SDK packages
  directly.

## Resolution

Without `extraction.tsconfig`, relative imports resolve lexically with a fixed extension and
`index.*` order. JavaScript specifiers such as `./order.js` resolve to authored TypeScript files
such as `order.ts`. A bare dependency becomes `package:<root>` only when an enclosing
`package.json` declares that root; otherwise BCE records the specifier as unresolved because it may
be a project alias. `node:` imports (including mandatory-prefix modules) and the public Node 22
unprefixed built-ins normalize to `builtin:` targets from a source-pinned vocabulary, so Node 22
and Node 24 produce the same graph.

Set `extraction.tsconfig` to one repository-relative config file when the repository uses
`baseUrl`, `paths`, or extended TypeScript configuration:

```json
{
  "extraction": {
    "profile": "typescript-module-graph",
    "paths": ["src/**/*.ts", "src/**/*.tsx"],
    "minFiles": 12,
    "tsconfig": "tsconfig.json"
  }
}
```

The BCE glob syntax does not support brace expansion, so each extension is a separate entry.
Extended configs must be repository-owned relative files. BCE refuses configs outside the
repository or under `node_modules` so module resolution cannot change independently of the gated
revision.

## What is observed

The AST provider records static imports, type-only imports, re-exports, JavaScript JSDoc `@import`,
TypeScript `import = require()` and `import("...")` types, unshadowed literal `require()` and
`require.resolve()`, and literal dynamic imports. Relative targets may resolve to repository modules outside the scanned component set;
that preserves the observed edge while `scopePaths` controls which importers are governed.

Computed imports, undeclared bare specifiers, and unresolved aliases are located under
`coverage.unresolvedImports`. A C2 or C3
boundary whose importer scope includes one of those facts fails closed: an unknown target is not
evidence that the required edge exists or the forbidden edge does not. Invalid source syntax,
invalid or escaping tsconfig resolution, imports escaping the repository, and line-scan requests
are refusals.

## Honest limits

This is a direct-import graph. It does not claim transitive reachability, cycle detection,
runtime-only loading, bundler plugin resolution, ownership inference, package-tag inference, or
automatic workspace expansion. Glob the files you intend to scan, set a real `minFiles` floor,
and use a tsconfig when aliases matter.

Next: [choose another executable boundary](first-win.md), [read C1–C4](constraint-guide.md), or
[install the gate in advisory mode](adopt-existing-repo.md).
