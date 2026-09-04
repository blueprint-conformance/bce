/**
 * Quality matrix for the `bce gate` PR-gate mechanism (the D13 anti-shelfware gate).
 * Proves: blueprint discovery, scope-intersection selection, green→pass / drift→fail,
 * unrelated-change skip, fail-closed on a malformed blueprint + on an empty scan.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGate, discoverBlueprints, blueprintTouchesChanges } from '../src/gate.js';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
const blueprint: EngineeringBlueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));

/** Arrange a throwaway "contributor repo": .blueprints/<bp> + a source variant. */
function arrangeRepo(sourceVariant: 'conformant' | 'drift-no-register' | 'drift-forbidden-import' | 'none'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-gate-'));
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  fs.copyFileSync(BP_PATH, path.join(dir, '.blueprints', path.basename(BP_PATH)));
  if (sourceVariant !== 'none') {
    const srcFrom = path.join(FIXROOT, 'extension-surface', sourceVariant, 'src');
    fs.cpSync(srcFrom, path.join(dir, 'src'), { recursive: true });
  }
  return dir;
}

const EXT = 'src/extensions/luna-chat.extension.ts';

describe('discoverBlueprints', () => {
  it('finds the authored blueprint under .blueprints', () => {
    const dir = arrangeRepo('conformant');
    const found = discoverBlueprints(path.join(dir, '.blueprints'));
    expect(found).toHaveLength(1);
    expect(found[0].endsWith('.blueprint.json')).toBe(true);
  });

  it('returns [] for a missing dir (no throw)', () => {
    expect(discoverBlueprints('/nonexistent/dir/xyz')).toEqual([]);
  });
});

describe('blueprintTouchesChanges (scope intersection)', () => {
  it('selects the blueprint when a changed file matches its scope', () => {
    expect(blueprintTouchesChanges('.', blueprint, [EXT])).toBe(true);
  });
  it('does NOT select when the change is unrelated', () => {
    expect(blueprintTouchesChanges('.', blueprint, ['docs/README.md'])).toBe(false);
  });
  it('selects on a null changed set (full sweep)', () => {
    expect(blueprintTouchesChanges('.', blueprint, null)).toBe(true);
  });
});

describe('runGate — green/red/skip', () => {
  it('CONFORMANT repo, extension changed → pass, not failed', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), [EXT], 'ast');
    expect(r.blueprintsSelected).toBe(1);
    expect(r.failed).toBe(false);
    expect(r.reports[0].verdict).toBe('pass');
  });

  it('DRIFT (forbidden import) repo, extension changed → failed, exact constraint', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    const r = runGate(dir, path.join(dir, '.blueprints'), [EXT], 'ast');
    expect(r.failed).toBe(true);
    expect(r.reports[0].violations.map((v) => v.constraintId)).toContain('no-direct-provider-sdk');
  });

  it('DRIFT (no governed registration) repo → failed', () => {
    const dir = arrangeRepo('drift-no-register');
    const r = runGate(dir, path.join(dir, '.blueprints'), [EXT], 'ast');
    expect(r.failed).toBe(true);
    expect(r.reports[0].violations.map((v) => v.constraintId)).toContain('ext-registers-through-governed-path');
  });

  it('UNRELATED change → zero selected is a structural refusal, never a vacuous pass', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    const r = runGate(dir, path.join(dir, '.blueprints'), ['docs/README.md'], 'ast');
    expect(r.blueprintsSelected).toBe(0);
    expect(r.failed).toBe(true);
    expect(r.refusals?.[0]).toContain('0 of 1');
  });

  it('FULL SWEEP (changed=null) on a drift repo → failed', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(true);
  });
});

describe('runGate — hardening (re-verify round 6)', () => {
  it('#1 line-scan is REFUSED for an plugin-surface blueprint with governedModules (no false-reject)', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'line-scan');
    expect(r.failed).toBe(true);
    expect(r.reports[0].summary).toContain('ast');
  });

  it('#1 the SAME conformant repo PASSES on the ast extractor (the faithful path)', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(false);
  });
});

describe('runGate — fail-closed', () => {
  it('refuses while a policy transition lock indicates interrupted or concurrent landing', () => {
    const dir = arrangeRepo('conformant');
    fs.writeFileSync(path.join(dir, '.blueprints', '.bce-policy-transition.lock'), '{"state":"transition-in-progress"}\n');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(true);
    expect(r.refusals?.join(' ')).toContain('policy transition may have been interrupted');
  });

  it('a malformed blueprint is a gate FAILURE, never a silent pass', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-gate-bad-'));
    fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.blueprints', 'broken.blueprint.json'), '{ not valid json');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(true);
    expect(r.reports[0].summary).toContain('failed to parse');
  });

  it('an empty scan (blueprint scope resolves to zero files) fails closed, never scores 100', () => {
    // conformant blueprint but NO source present → scan resolves 0 files < minFiles(1).
    const dir = arrangeRepo('none');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(true);
    expect(r.reports[0].summary).toContain('fail-closed');
  });
});
