import type { CompilerPass, CompilerPassDescriptor, CompilerRefusal, PassReceipt } from './ir.js';
import { compilerDigest } from './canonical.js';

/** Validate the declared DAG before running any pass; ordering is explicit, not ambient. */
export function validatePassPipeline(passes: readonly CompilerPassDescriptor[]): CompilerRefusal[] {
  const refusals: CompilerRefusal[] = [];
  const byId = new Map(passes.map(pass => [pass.id, pass]));
  if (byId.size !== passes.length || passes.some(pass => !pass.id || pass.version !== '1' || !pass.inputSchema || !pass.outputSchema)) {
    refusals.push({ code: 'invalid-pass', reason: 'pass ids and schemas must be present, ids unique, and versions supported' });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      refusals.push({ code: 'dependency-cycle', reason: `pass dependency cycle at ${id}` });
      return;
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dep)) refusals.push({ code: 'missing-dependency', reason: `${id} requires missing pass ${dep}` });
      else visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const pass of passes) visit(pass.id);
  const completed = new Set<string>();
  for (const pass of passes) {
    if (pass.dependencies.some(dep => byId.has(dep) && !completed.has(dep))) {
      refusals.push({ code: 'invalid-pass', reason: `${pass.id} appears before its dependency in execution order` });
    }
    completed.add(pass.id);
  }
  return refusals;
}

/** Freeze owned JSON-like artifacts; acquisition inputs are cloned before reaching this helper. */
export function freezeArtifact<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeArtifact(child);
    Object.freeze(value);
  }
  return value;
}

/** Internal single-pass runner; the fixed pipeline validates its DAG separately. */
export function runCompilerPass<I, O>(pass: CompilerPass<I, O>, input: I, receipts: PassReceipt[]): O {
  const ownedInput = freezeArtifact(structuredClone(input));
  const inputDigest = compilerDigest(ownedInput);
  const output = freezeArtifact(pass.run(ownedInput));
  const { run: _run, ...descriptor } = pass;
  receipts.push({ pass: descriptor, inputDigest, outputDigest: compilerDigest(output), cache: 'not-used' });
  return output;
}
