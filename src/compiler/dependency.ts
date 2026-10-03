/** The single production semantic owner of forbiddenDependency. No acquisition here. */
import type { ConstraintOutcomeIR, DiagnosticIR, FactIR, NoEdgePredicate } from './ir.js';
import type { Violation } from '../report.js';
import { compilerDigest, moduleTargetMatches, pathGlobToRe } from './canonical.js';

export function evaluateNoEdge(predicate: NoEdgePredicate, facts: FactIR): ConstraintOutcomeIR {
  const graph = facts.staticAst.graph;
  const diagnostics: DiagnosticIR[] = [];
  const add = (violation: Omit<Violation, 'constraintId' | 'severity' | 'evidenceType'>,
    pointer: string, kind: DiagnosticIR['kind'] = 'violation'): void => {
    const legacyViolation: Violation = { constraintId: predicate.constraintId, severity: predicate.severity,
      evidenceType: 'staticAst', ...violation };
    const factSource = { artifact: 'architecture-graph.json', pointer };
    diagnostics.push({ id: compilerDigest({ source: predicate.source, factSource, kind, legacyViolation }),
      kind, policySource: predicate.source, factSource, legacyViolation });
  };
  const scopeMatchers = predicate.scope.map(pathGlobToRe);
  if (predicate.mode === 'module-import') {
    const sources = graph.components.filter(component => component.type === predicate.moduleComponentType &&
      scopeMatchers.some(matcher => matcher.test(component.path)));
    if (sources.length === 0) {
      add({ component: predicate.moduleComponentType!, evidenceRef: predicate.scope.join(','),
        observed: `no ${predicate.moduleComponentType} component matched the forbidden dependency source scope`,
        expected: `at least one source module matching ${predicate.scope.join('|')} so the boundary can be graded` }, '/components');
    }
    const sourceIds = new Set(sources.map(component => component.id));
    graph.guardEdges.forEach((edge, index) => {
      if (edge.type !== 'imports' || !sourceIds.has(edge.from) || !moduleTargetMatches(edge.to, predicate.target)) return;
      add({ component: edge.from, evidenceRef: edge.evidenceRef,
        observed: `forbidden direct import ${edge.from} -> ${edge.to} is present`,
        expected: `no direct imports edge from ${predicate.scope.join('|')} to ${predicate.target}` }, `/guardEdges/${index}`);
    });
    (graph.coverage.unresolvedImports ?? []).forEach((item, index) => {
      if (!sourceIds.has(item.from)) return;
      add({ component: item.from, evidenceRef: item.ref,
        observed: `${item.kind} ${item.specifier} is unresolved (${item.reason}); absence of a forbidden target cannot be proven`,
        expected: `every direct import from the governed source scope resolves and none targets ${predicate.target}` },
      `/coverage/unresolvedImports/${index}`, 'uncertainty');
    });
  } else {
    const anyFrom = predicate.sourceSelector === '*';
    graph.guardEdges.forEach((edge, index) => {
      if (edge.to !== predicate.target ||
        !(anyFrom || edge.from === predicate.sourceSelector || edge.from.startsWith('file:'))) return;
      const ref = edge.evidenceRef ?? '';
      const hash = ref.indexOf('#L');
      const path = hash >= 0 ? ref.slice(0, hash) : ref;
      if (!(scopeMatchers.length === 0 || scopeMatchers.some(matcher => matcher.test(path)))) return;
      add({ component: edge.from, evidenceRef: edge.evidenceRef,
        observed: `forbidden edge ${edge.from} -> ${predicate.target} is present`,
        expected: `no ${anyFrom ? '' : `${predicate.sourceSelector} -> `}${predicate.target} edge` }, `/guardEdges/${index}`);
    });
  }
  return { constraintIndex: predicate.constraintIndex, constraintId: predicate.constraintId, source: predicate.source,
    status: diagnostics.some(d => d.kind === 'violation') ? 'fail' : diagnostics.length > 0 ? 'indeterminate' : 'pass', diagnostics };
}
