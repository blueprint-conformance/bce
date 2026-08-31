/**
 * Mode module + graduation ceremony (SPEC §9 mode doctrine) — the in-process unit layer.
 * The e2e CLI proof lives in self-gate-honesty.test.ts; this file pins the mode primitives directly:
 * config resolution (incl. fail-closed on a bad config), the exit-semantics-only contract, the
 * one-way + recorded graduation, and the widen-only byte-identity of the pre-mode gate path.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveMode,
  exitCodeForGate,
  appendGraduationRecord,
  writeModeConfig,
  readGraduationRecord,
  ModeConfigError,
  ADVISORY_BANNER,
  MODE_CONFIG_BASENAME,
  GRADUATION_RECORD_RELPATH,
} from '../src/mode.js';
import { runGate } from '../src/gate.js';
import { stableStringify } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const LUNA_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bce-mode-'));
}
function writeConfig(dir: string, contents: string): void {
  fs.writeFileSync(path.join(dir, MODE_CONFIG_BASENAME), contents);
}

describe('resolveMode — the committed config IS the mode (never a flag, never an env var)', () => {
  it('ABSENT config → enforced, explicit:false (the byte-identical legacy path)', () => {
    const dir = tmp();
    const r = resolveMode(dir);
    expect(r.mode).toBe('enforced');
    expect(r.explicit).toBe(false);
    expect(r.configPath).toBe(path.join(dir, MODE_CONFIG_BASENAME));
  });

  it('{"mode":"enforced"} → enforced, explicit:true (a stamped-but-enforcing posture is legible)', () => {
    const dir = tmp();
    writeConfig(dir, '{"mode":"enforced"}\n');
    const r = resolveMode(dir);
    expect(r.mode).toBe('enforced');
    expect(r.explicit).toBe(true);
  });

  it('{"mode":"advisory"} → advisory, explicit:true', () => {
    const dir = tmp();
    writeConfig(dir, '{"mode":"advisory"}\n');
    expect(resolveMode(dir)).toMatchObject({ mode: 'advisory', explicit: true });
  });

  it('an optional rationaleRef key is tolerated (self-documenting config)', () => {
    const dir = tmp();
    writeConfig(dir, '{"mode":"enforced","rationaleRef":".blueprints/GRADUATION.md"}\n');
    expect(resolveMode(dir).mode).toBe('enforced');
  });

  it('FAIL-CLOSED: bad JSON throws ModeConfigError (never a silent default)', () => {
    const dir = tmp();
    writeConfig(dir, '{not json');
    expect(() => resolveMode(dir)).toThrow(ModeConfigError);
  });

  it('FAIL-CLOSED: an unknown mode value throws (never silently graded as either posture)', () => {
    const dir = tmp();
    writeConfig(dir, '{"mode":"warn-only"}');
    expect(() => resolveMode(dir)).toThrow(ModeConfigError);
    expect(() => resolveMode(dir)).toThrow(/enforced.*advisory/);
  });

  it('FAIL-CLOSED: an unknown top-level key throws (no smuggled bypass field)', () => {
    const dir = tmp();
    writeConfig(dir, '{"mode":"advisory","skip":true}');
    expect(() => resolveMode(dir)).toThrow(ModeConfigError);
    expect(() => resolveMode(dir)).toThrow(/unknown key/);
  });

  it('FAIL-CLOSED: a non-object config (array / scalar) throws', () => {
    const dir = tmp();
    writeConfig(dir, '["advisory"]');
    expect(() => resolveMode(dir)).toThrow(ModeConfigError);
    const dir2 = tmp();
    writeConfig(dir2, '"advisory"');
    expect(() => resolveMode(dir2)).toThrow(ModeConfigError);
  });
});

describe('exitCodeForGate — mode changes ONLY the exit code, nothing else', () => {
  it('enforced: passes 0, fails 1 (the real fail-closed signal)', () => {
    expect(exitCodeForGate(false, 'enforced')).toBe(0);
    expect(exitCodeForGate(true, 'enforced')).toBe(1);
  });

  it('advisory: ALWAYS 0 — even on a real red (that IS the adoption posture)', () => {
    expect(exitCodeForGate(false, 'advisory')).toBe(0);
    expect(exitCodeForGate(true, 'advisory')).toBe(0);
  });
});

describe('ADVISORY_BANNER — unmissable, and honest about what advisory is (and is NOT)', () => {
  it('names ADVISORY, the non-block, and that it is NOT a skip flag', () => {
    expect(ADVISORY_BANNER).toContain('ADVISORY MODE');
    expect(ADVISORY_BANNER.toLowerCase()).toContain('do not block');
    expect(ADVISORY_BANNER.toLowerCase()).toContain('not a skip');
    expect(ADVISORY_BANNER).toContain('bce graduate');
  });
});

describe('graduation ceremony — one-way + recorded (the widen-only ratchet for adoption posture)', () => {
  it('appendGraduationRecord writes a parse-stable entry recovered by readGraduationRecord', () => {
    const dir = tmp();
    const p = appendGraduationRecord(dir, 'graduate', 'advisory', 'enforced', 'we are ready to block');
    expect(p).toBe(path.join(dir, GRADUATION_RECORD_RELPATH));
    expect(fs.existsSync(p)).toBe(true);
    const entries = readGraduationRecord(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      direction: 'graduate',
      from: 'advisory',
      to: 'enforced',
      rationale: 'we are ready to block',
    });
  });

  it('a downgrade entry is recorded distinctly and appends (history is append-only, auditable)', () => {
    const dir = tmp();
    appendGraduationRecord(dir, 'graduate', 'advisory', 'enforced', 'first: turned it on');
    appendGraduationRecord(dir, 'downgrade', 'enforced', 'advisory', 'incident: too noisy for the release, backing off with a plan');
    const entries = readGraduationRecord(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].direction).toBe('graduate');
    expect(entries[1].direction).toBe('downgrade');
    expect(entries[1].from).toBe('enforced');
    expect(entries[1].to).toBe('advisory');
  });

  it('the record has NO wall-clock (deterministic content — same ceremony, same bytes)', () => {
    const a = tmp();
    const b = tmp();
    appendGraduationRecord(a, 'graduate', 'advisory', 'enforced', 'ready');
    appendGraduationRecord(b, 'graduate', 'advisory', 'enforced', 'ready');
    const ba = fs.readFileSync(path.join(a, GRADUATION_RECORD_RELPATH), 'utf8');
    const bb = fs.readFileSync(path.join(b, GRADUATION_RECORD_RELPATH), 'utf8');
    expect(ba).toBe(bb);
    expect(ba).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp leaked in
  });

  it('writeModeConfig round-trips through resolveMode (config is canonical, resolvable)', () => {
    const dir = tmp();
    writeModeConfig(dir, 'advisory');
    expect(resolveMode(dir)).toMatchObject({ mode: 'advisory', explicit: true });
    writeModeConfig(dir, 'enforced', '.blueprints/GRADUATION.md');
    expect(resolveMode(dir).mode).toBe('enforced');
    // omit-not-empty: a plain write has no rationaleRef key; a write WITH one carries it.
    writeModeConfig(dir, 'advisory');
    expect(fs.readFileSync(path.join(dir, MODE_CONFIG_BASENAME), 'utf8')).toBe('{\n  "mode": "advisory"\n}\n');
  });
});

describe('widen-only — the pre-mode gate path is byte-identical (no config → no mode stamp)', () => {
  function arrangeRepo(): string {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
    fs.copyFileSync(LUNA_PATH, path.join(dir, '.blueprints', path.basename(LUNA_PATH)));
    fs.cpSync(path.join(FIXROOT, 'extension-surface', 'conformant', 'src'), path.join(dir, 'src'), {
      recursive: true,
    });
    return dir;
  }

  it('runGate output carries NO mode key (the field is stamped only by the CLI, only when config is explicit)', () => {
    // runGate itself is mode-agnostic — the ADOPTION POSTURE is a CLI concern (exit code + stamp).
    // This proves the engine core stayed byte-clean: no report from runGate mentions mode.
    const dir = arrangeRepo();
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.failed).toBe(false);
    for (const rep of r.reports) {
      expect('mode' in rep).toBe(false);
      expect(stableStringify(rep)).not.toContain('"mode"');
    }
  });
});
