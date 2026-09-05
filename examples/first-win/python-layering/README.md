# First win — Python module layering

**Starting shape:** one Python service package with an API adapter above its domain code.

**The rule:** internal modules must not import the public API adapter. The starting tree contains
one reverse import in `src/service/domain/orders.py`.

**Availability:** this walkthrough uses `python-module-graph` from the unpublished `v0.3.0`
source candidate. Run it with a built source checkout; `bce-engine@0.2.0` cannot parse this profile.

## 0. Work in a copy

```bash
cp -R examples/first-win/python-layering/repo /tmp/bce-first-win-python-layering
cd /tmp/bce-first-win-python-layering
mkdir -p .blueprints
```

`bce` below means `node /path/to/bce/dist/cli.js` from a built candidate checkout.

## 1. Author one direct boundary

The extraction scope includes the whole Python package so BCE can resolve both ends of the import.
The C3 target then forbids only edges that point to the API module.

```bash
bce author \
  --id internals-do-not-import-api \
  --intent-ref policy/python-api-is-an-entrypoint \
  --constraint "requiredComponent:pythonModule:critical" \
  --constraint "forbiddenDependency:module:src/service/api.py:critical" \
  --extraction-profile python-module-graph \
  --scope-paths "src/**/*.py" \
  --python-root src \
  --min-files 4 \
  --repo . \
  --out .blueprints/internals-do-not-import-api.blueprint.json
```

```console
authored DRAFT blueprint internals-do-not-import-api@0.1.0 -> .blueprints/internals-do-not-import-api.blueprint.json (2 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 4 file(s) in . (4 component(s) observed)
```

The generated draft carries `minEngineVersion: "0.3.0"` and `pythonRoots: ["src"]`. Python roots
make absolute and relative package resolution explicit instead of guessing from the working tree.

## 2. Gate it — RED at the reverse edge

```bash
bce gate --repo . --extractor ast --all
```

```console
::error::blueprint internals-do-not-import-api@0.1.0 FAILED — score 60: 1 NEW violation(s). 2 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-dependency-module-src-service-api-py (critical): 1 violation(s)
::error::    - [forbidden-dependency-module-src-service-api-py/critical] module:src/service/domain/orders.py
        observed: forbidden direct import module:src/service/domain/orders.py -> module:src/service/api.py is present
        expected: no direct imports edge from src/**/*.py to module:src/service/api.py
        at:       src/service/domain/orders.py#L1
```

## 3. Fix the dependency direction — GREEN

Keep normalization inside the domain instead of calling back into the API adapter:

```python
def normalize_order_id(order_id: str) -> str:
    return order_id.strip().lower()
```

```bash
bce gate --repo . --extractor ast
```

```console
  ✓ internals-do-not-import-api@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

This profile observes static direct imports. Dynamic and unresolved in-scope imports produce a
blocking fail-closed violation. Syntax errors and ambiguous roots produce a hard refusal.

---

Back to [the first-win matrix](../README.md) · exact Python selectors and uncertainty semantics live
in the [Python module-graph guide](../../../docs/python-module-graph.md).
