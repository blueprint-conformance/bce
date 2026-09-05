# Python module graph — enforce direct architecture boundaries

Use `python-module-graph` when a Python rule is about which repository modules may import which
other modules. Every scanned `.py` file becomes a `pythonModule` component. A pinned structured
parser records statically declared imports as policy-independent `imports` edges before evaluation.

This profile is in the unpublished `v0.3.0` source candidate. It is additive: the released
`python-import-surface` profile remains available with its existing behavior. From a source
checkout, build and run the structured proof:

```bash
npm ci
npm run build
node dist/cli.js demo --recipe python-module-layering
```

The conforming tree has the API adapter depend inward on domain code and scores 100. The drift tree
adds one reverse domain-to-API import; C3 names the importer, resolved target, and source line.

## Directional layering

This is the core fragment from the [complete executable fixture](../fixtures/python-module-layering.blueprint.json):

```json
{
  "minEngineVersion": "0.3.0",
  "constraints": [
    {
      "id": "domain-cannot-import-api",
      "type": "forbiddenDependency",
      "severity": "critical",
      "from": "*",
      "to": "module:src/service/api.py",
      "scopePaths": ["src/service/domain/**/*.py"]
    }
  ],
  "extraction": {
    "profile": "python-module-graph",
    "paths": ["src/**/*.py"],
    "pythonRoots": ["src"],
    "minFiles": 4
  }
}
```

`extraction.paths` determines which files exist in the observed graph. `scopePaths` selects the
importers governed by C2 or C3. `to` selects the dependency target. Keep the scan broad enough to
include repository targets while keeping each constraint's importer scope as narrow as its intent.

Run the measured [author → RED → fix → GREEN Python walkthrough](../examples/first-win/python-layering/README.md)
to create a boundary against a four-file service package.

## Python roots are explicit

`pythonRoots` are repository-relative import roots such as `src`, `lib`, or `.`. They define how a
file path becomes an import name: under root `src`, `src/service/api.py` is `service.api`, and
`src/service/__init__.py` is `service`. BCE does not infer roots from the shell, an active virtual
environment, or `sys.path`.

Every scanned Python file must belong to exactly one configured root. BCE refuses missing,
duplicate, overlapping, globbed, escaping, or symlink-escaping roots; duplicate import names and
case-fold collisions also refuse. These checks keep the graph stable across operating systems and
working directories.

## Target selectors

| Selector | Matches | Example |
|---|---|---|
| `module:<repo-path-or-glob>` | a resolved `.py` file inside the repository | `module:src/service/api.py` |
| `package:<import-root>` | one external Python import namespace | `package:requests` |

Python package selectors name import namespaces, not PyPI distribution names. For example, a
distribution may install a differently named namespace; BCE does not consult installed package
metadata. This profile does not support Node-style `builtin:` targets.

## What is observed

The parser records `import x`, dotted and aliased imports, `from x import y`, relative imports,
parenthesized imports, imports after semicolons, and imports inside suites or nested blocks. When an
imported member is itself a scanned module, BCE records that module edge. Otherwise an absolute
canonical name becomes `package:<top-level-namespace>`.

C1 can require at least one `pythonModule`. C2 and C3 grade direct `imports` edges and require both
`scopePaths` and `to`. C2 means every in-scope importer must carry the selected direct edge. C3
rejects every matching direct edge. C4, C5, and C6 continue to work over component paths, scanned
files, and line content respectively. Python call and egress semantics are not claimed.

## Uncertainty blocks relevant boundaries

BCE locates dynamic `__import__`, `importlib.import_module`, `exec`, `eval`, and mutations of
`sys.path`, `sys.meta_path`, or `sys.path_hooks` as unresolved import facts. An unresolved fact in a
C2 or C3 importer scope produces a blocking fail-closed violation instead of evidence for GREEN.

The extractor also refuses invalid Python syntax, non-UTF-8 source or coding cookies, symlinked
source files, relative imports that escape a root, ambiguous namespace imports, non-`.py` files,
and the `line-scan` extractor kind. Source is decoded as UTF-8; a UTF-8 BOM is accepted and removed.

## Honest limits

This is a direct static-import graph. It does not claim transitive reachability, cycle detection,
runtime-only loading, installed-distribution resolution, custom import hooks, `.pyi` stub semantics,
decorator or call graphs, egress observation, or automatic import-root inference. Declare the files
and roots you intend to govern, set a real `minFiles` floor, and treat every refusal as work to make
the boundary observable.

Next: [choose another executable boundary](first-win.md), [read C1–C4](constraint-guide.md), or
[install the gate in advisory mode](adopt-existing-repo.md).
