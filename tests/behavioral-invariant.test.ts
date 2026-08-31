/**
 * behavioral-invariant.test.ts — the RUNTIME not-a-mock constraint (the substance-conformance bundle).
 *
 * Proves the constant-function detector — the property that makes a ~11-line hello-world (p2-dashboard,
 * whose served output is byte-identical regardless of input) provably FAIL, while a real app that
 * produces input-conditioned output PASSES.
 *
 * The `served-runtime` probe writes `behaviorObservation` graph nodes:
 *   id:   behavior:<behaviorRef>:<stimulusId>
 *   type: behaviorObservation
 *   path: <outputHash>|<oracleSatisfied 0|1>
 * evaluate() reads them; teeth.ts proves the constraint is TOOTHED (a mocked redeploy reddens it).
 */
import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/report.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { parseBlueprint } from '../src/schema.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph, ObservedComponent } from '../src/graph.js';

function bp(constraints: EngineeringBlueprint['constraints']): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'bi-bp', version: '1.0.0', status: 'approved', ownerRole: 'platform-engineer', stewardRole: 'blueprint-steward' },
    intentRefs: ['intent:real-dashboard-varies-with-input'],
    scope: { repositories: ['repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints,
    evidenceRequirements: [{ type: 'runtimeProbe', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
  });
}

/** Build a behaviorObservation node. */
function obs(ref: string, stimulus: string, outputHash: string, oracleOk: boolean): ObservedComponent {
  return { id: `behavior:${ref}:${stimulus}`, type: 'behaviorObservation', path: `${outputHash}|${oracleOk ? '1' : '0'}`, line: 1 };
}

function graph(components: ObservedComponent[]): ArchitectureGraph {
  return {
    schemaVersion: '1',
    ctRepoRevision: 'testsha',
    components,
    guardEdges: [],
    coverage: { extractor: 'ast', filesScanned: 6, unsupported: [] },
  };
}

const BI = (behaviorRef: string) =>
  ({ id: 'c-substance', type: 'behavioralInvariant' as const, severity: 'critical' as const, behaviorRef });

describe('behavioralInvariant — the runtime not-a-mock constraint', () => {
  it('MOCK FAILS: constant output across distinct + held-out stimuli → constant-function violation (the p2-dashboard signature)', () => {
    // A hello-world serves byte-identical output no matter the stimulus → single hash → FAIL.
    const g = graph([
      obs('dash', 's1', 'HELLOWORLD', true),
      obs('dash', 's2', 'HELLOWORLD', true),
      obs('dash', 's3-held-out', 'HELLOWORLD', true),
    ]);
    const r = evaluate(bp([BI('dash')]), g, 'plugin-surface');
    expect(r.verdict).not.toBe('pass');
    expect(r.violations.some((v) => v.observed.includes('constant output'))).toBe(true);
  });

  it('REAL APP PASSES: output VARIES with input + every oracle satisfied → pass', () => {
    const g = graph([
      obs('dash', 's1', 'OUTPUT_FOR_A', true),
      obs('dash', 's2', 'OUTPUT_FOR_B', true),
      obs('dash', 's3-held-out', 'OUTPUT_FOR_HELDOUT', true),
    ]);
    const r = evaluate(bp([BI('dash')]), g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });

  it('ORACLE VIOLATION FAILS: output varies but one stimulus violated its property oracle', () => {
    const g = graph([
      obs('dash', 's1', 'OUTPUT_FOR_A', true),
      obs('dash', 's2', 'OUTPUT_FOR_B', false), // oracle failed on this stimulus
    ]);
    const r = evaluate(bp([BI('dash')]), g, 'plugin-surface');
    expect(r.verdict).not.toBe('pass');
    expect(r.violations.some((v) => v.observed.includes('property oracle'))).toBe(true);
  });

  it('FAIL-CLOSED: fewer than 2 observations cannot prove variation → violation', () => {
    const g = graph([obs('dash', 's1', 'OUTPUT_FOR_A', true)]);
    const r = evaluate(bp([BI('dash')]), g, 'plugin-surface');
    expect(r.verdict).not.toBe('pass');
    expect(r.violations.some((v) => v.observed.includes('cannot prove input-conditioned variation'))).toBe(true);
  });

  it('FAIL-CLOSED: a behavioralInvariant with no behaviorRef refuses (never a silent pass)', () => {
    const g = graph([]);
    const r = evaluate(bp([{ id: 'c-substance', type: 'behavioralInvariant', severity: 'critical' }]), g, 'plugin-surface');
    expect(r.verdict).not.toBe('pass');
    expect(r.violations.some((v) => v.observed.includes('no behaviorRef'))).toBe(true);
  });

  it('TEETH: a behavioralInvariant is TOOTHED — a mocked (constant-output) redeploy would redden it', () => {
    // Over a graph with a REAL varying observation set (currently green), teeth injects a
    // constant-output set and confirms the constraint would go RED → TOOTHED.
    const g = graph([
      obs('dash', 's1', 'OUTPUT_FOR_A', true),
      obs('dash', 's2', 'OUTPUT_FOR_B', true),
    ]);
    const t = assessTeeth(bp([BI('dash')]), g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.verdict).toBe('toothed');
  });
});
