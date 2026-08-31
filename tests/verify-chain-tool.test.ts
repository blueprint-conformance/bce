/**
 * verify-chain-tool.test.ts — the zero-dependency verifier verifies, and refuses.
 *
 * `tools/verify-chain.mjs` is the reviewer-facing chain verifier: standalone
 * (imports nothing from src/ or dist/), runnable with node alone. Locked here:
 *
 *  1. INTACT  — the committed example chain (`evidence/example-chain/`, produced
 *     by real `bce run --emit --prev-hash` invocations) verifies, exit 0. This
 *     doubles as a guard on the committed artifact itself: any accidental edit
 *     to a record file turns this test red.
 *  2. TAMPER  — editing a hashed field (score/verdict) while keeping the stored
 *     hash fails at the re-derivation check, exit 1 (the discriminating proof
 *     that the verifier actually reads bytes, not vibes).
 *  3. EXCISE  — silently deleting a middle record fails at the link check,
 *     exit 1 (redaction-by-field-editing AND silent omission are both caught;
 *     the only publishable redaction is a genesis-anchored prefix — see
 *     docs/evidence-format.md §5).
 *  4. AGREEMENT — the standalone verifier and the engine's own
 *     `verifyEvidenceChain` (src/emit.ts) agree on the same records.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyEvidenceChain, type EvidenceRecord } from '../src/emit.js';

const ROOT = path.join(__dirname, '..');
const VERIFIER = path.join(ROOT, 'tools', 'verify-chain.mjs');
const CHAIN_DIR = path.join(ROOT, 'evidence', 'example-chain');

function runVerifier(target: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [VERIFIER, target], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function recordFiles(): string[] {
  return fs
    .readdirSync(CHAIN_DIR)
    .filter((n) => n.endsWith('.json'))
    .sort();
}

function copyChain(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-chain-'));
  for (const f of recordFiles()) fs.copyFileSync(path.join(CHAIN_DIR, f), path.join(tmp, f));
  return tmp;
}

describe('tools/verify-chain.mjs — zero-dep evidence-chain verifier', () => {
  it('INTACT: the committed example chain verifies (exit 0)', () => {
    expect(recordFiles().length).toBeGreaterThanOrEqual(3);
    const r = runVerifier(CHAIN_DIR);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('CHAIN INTACT');
  });

  it('TAMPER: editing a hashed field with the stored hash kept fails re-derivation (exit 1)', () => {
    const tmp = copyChain();
    const victim = path.join(tmp, recordFiles()[1] as string);
    const rec = JSON.parse(fs.readFileSync(victim, 'utf8')) as Record<string, unknown>;
    rec['score'] = 42;
    rec['verdict'] = 'fail';
    fs.writeFileSync(victim, `${JSON.stringify(rec, null, 2)}\n`);
    const r = runVerifier(tmp);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('hash does not re-derive');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('EXCISE: silently deleting a middle record breaks the next link (exit 1)', () => {
    const tmp = copyChain();
    fs.rmSync(path.join(tmp, recordFiles()[1] as string));
    const r = runVerifier(tmp);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not match the prior record's hash");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('AGREEMENT: the engine-side verifyEvidenceChain accepts the same committed records', () => {
    const chain = recordFiles().map(
      (f) => JSON.parse(fs.readFileSync(path.join(CHAIN_DIR, f), 'utf8')) as EvidenceRecord,
    );
    expect(verifyEvidenceChain(chain)).toBe(-1);
    // and agrees on the tamper: flip one hashed field → first broken index is that record's.
    const tampered = chain.map((r, i) => (i === 1 ? { ...r, score: 42 } : r));
    expect(verifyEvidenceChain(tampered)).toBe(1);
  });
});
