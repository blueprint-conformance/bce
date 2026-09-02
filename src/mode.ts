/**
 * Mode doctrine — advisory vs enforced (SPEC §9 + §5).
 *
 * The engine has ONE fail-closed grader. `mode` never touches the grader: it changes ONLY the
 * `gate` command's EXIT SEMANTICS, so an operator can adopt the gate on a dirty repo without a
 * red build, while still seeing the FULL, unsoftened verdict every run.
 *
 *   - ENFORCED (the default, and the product): a non-pass verdict fails the build (exit 1). This is
 *     the Table-1 claim; it never softens. When `.bce-mode.json` is ABSENT, this path is
 *     BYTE-IDENTICAL to the pre-mode engine — no `mode` key on any report, no banner (widen-only §10).
 *   - ADVISORY: the identical verdict is computed and printed, an UNMISSABLE banner declares the
 *     violations do not block, a machine-readable `mode` field is stamped on every report, and the
 *     gate exits 0. Mistaking advisory for enforced is impossible by construction (the banner + the
 *     report `mode` field + the exit code all agree).
 *
 * The invariant, executable in `tests/gate-mode.test.ts` + `tests/self-gate-honesty.test.ts`:
 * advisory NEVER changes the computed score or violation set — only the exit code. It is NOT a skip
 * flag (there is no CLI flag at all; the mode lives in a committed, PR-reviewed config file) and it
 * is NOT a suppression (nothing is hidden — the full red is printed, loudly, every advisory run).
 *
 * Graduation (advisory → enforced) is ONE-WAY and RECORDED: `bce graduate` writes an in-repo
 * rationale record (`.blueprints/GRADUATION.md`) AND flips the config to enforced. A DOWNGRADE
 * (enforced → advisory) is refused UNLESS the same rationale record is written — loud, auditable,
 * never silent (SPEC §9 "a skip is always explicit"; the widen-only ratchet applied to adoption
 * posture: tightening advisory→enforced is free, relaxing enforced→advisory carries a recorded cost).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The two adoption postures. `enforced` is the fail-closed product; `advisory` is exit-0 adoption. */
export type GateMode = 'enforced' | 'advisory';

/** The canonical repo-level config file (a committed, PR-reviewed FILE — never a CLI flag). */
export const MODE_CONFIG_BASENAME = '.bce-mode.json';

/** The in-repo graduation rationale record (append-only ceremony log). Lives beside blueprints. */
export const GRADUATION_RECORD_RELPATH = path.join('.blueprints', 'GRADUATION.md');

/** The banner printed on EVERY advisory gate run — unmissable, by design. */
export const ADVISORY_BANNER =
  '════════════════════════════════════════════════════════════════════════════\n' +
  '  ⚠  ADVISORY MODE — violations do NOT block this build (exit 0).\n' +
  '     The full verdict below is REAL and unsoftened; the score and violations\n' +
  '     are identical to enforced mode. This is an adoption posture, NOT a skip\n' +
  '     flag: nothing is suppressed. Graduate to enforced with `bce graduate`.\n' +
  '════════════════════════════════════════════════════════════════════════════';

/** Raised on a malformed `.bce-mode.json` — fail-closed: a bad config never silently defaults. */
export class ModeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModeConfigError';
  }
}

/**
 * The resolved mode + the config path it came from (for messaging). `explicit` distinguishes an
 * ABSENT config (→ enforced default, byte-identical legacy path) from a config that literally says
 * `{"mode":"enforced"}` (→ stamp the mode field so the posture is legible even when enforcing).
 */
export interface ResolvedMode {
  mode: GateMode;
  explicit: boolean;
  configPath: string;
}

/**
 * Resolve the gate mode for a repo. ABSENT config → `enforced`, `explicit:false` (the legacy,
 * byte-identical path — no mode key gets stamped downstream). A PRESENT config is parsed STRICTLY:
 * it MUST be a JSON object with `mode` ∈ {enforced, advisory} and no unknown top-level keys — any
 * other shape is a `ModeConfigError` (fail-closed; a corrupt adoption config must never silently
 * grade as either posture). There is deliberately NO override parameter and NO env var: the mode is
 * the committed file, full stop (SPEC §9 — never a flag, never an ambient bypass).
 */
export function resolveMode(repoDir: string): ResolvedMode {
  const configPath = path.join(repoDir, MODE_CONFIG_BASENAME);
  if (!fs.existsSync(configPath)) {
    return { mode: 'enforced', explicit: false, configPath };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new ModeConfigError(`${MODE_CONFIG_BASENAME} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ModeConfigError(`${MODE_CONFIG_BASENAME} must be a JSON object with a "mode" field`);
  }
  const obj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((k) => k !== 'mode' && k !== 'rationaleRef');
  if (unknownKeys.length > 0) {
    throw new ModeConfigError(
      `${MODE_CONFIG_BASENAME} has unknown key(s): ${unknownKeys.join(', ')} (expected only "mode" [, "rationaleRef"])`,
    );
  }
  const m = obj.mode;
  if (m !== 'enforced' && m !== 'advisory') {
    throw new ModeConfigError(
      `${MODE_CONFIG_BASENAME} "mode" must be "enforced" or "advisory" (got ${JSON.stringify(m)})`,
    );
  }
  return { mode: m, explicit: true, configPath };
}

/**
 * Decide the process exit code for a gate result under a mode. This is the ONLY place mode changes
 * behavior: enforced returns the real red/green code; advisory always returns 0. The verdict itself
 * (which drives `failed`) is computed identically upstream — mode never re-grades.
 */
export function exitCodeForGate(failed: boolean, mode: GateMode): 0 | 1 {
  if (mode === 'advisory') return 0;
  return failed ? 1 : 0;
}

/** A single graduation/downgrade ceremony record, as parsed back from the record file. */
export interface GraduationEntry {
  direction: 'graduate' | 'downgrade';
  from: GateMode;
  to: GateMode;
  rationale: string;
}

/**
 * The heading line format for one ceremony entry in `.blueprints/GRADUATION.md`. Deterministic and
 * parse-stable (no wall-clock — the record's meaning is its content, mirroring the evidence chain's
 * no-wall-clock discipline). A reader — and `readGraduationRecord` — recovers the transition from
 * the heading and the rationale from the body.
 */
function graduationHeading(direction: 'graduate' | 'downgrade', from: GateMode, to: GateMode): string {
  const verb = direction === 'graduate' ? 'GRADUATE' : 'DOWNGRADE';
  return `## ${verb}: ${from} → ${to}`;
}

/**
 * Append a ceremony entry to `.blueprints/GRADUATION.md` (creating it with a header if absent).
 * Every transition — graduate OR downgrade — writes one, so the adoption posture's history is
 * always auditable in-repo. Returns the absolute record path written.
 */
export function appendGraduationRecord(
  repoDir: string,
  direction: 'graduate' | 'downgrade',
  from: GateMode,
  to: GateMode,
  rationale: string,
): string {
  const recordPath = path.join(repoDir, GRADUATION_RECORD_RELPATH);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const header =
    '# Gate mode graduation record\n\n' +
    'One-way, auditable transitions of this repo\'s conformance-gate adoption posture\n' +
    '(SPEC §9 mode doctrine). Every advisory↔enforced change appends an entry here — an\n' +
    'enforced→advisory downgrade is REFUSED without one. Newest entries append at the end.\n';
  const entry = `\n${graduationHeading(direction, from, to)}\n\n${rationale.trim()}\n`;
  if (!fs.existsSync(recordPath)) {
    fs.writeFileSync(recordPath, header + entry);
  } else {
    fs.appendFileSync(recordPath, entry);
  }
  return recordPath;
}

/**
 * Write (or overwrite) the `.bce-mode.json` config to a given mode. `rationaleRef` optionally points
 * at the graduation record so the config self-documents why it is where it is. Serialized canonically
 * (sorted keys, 2-space indent, trailing newline) to match the engine's byte-stable JSON discipline.
 */
export function writeModeConfig(repoDir: string, mode: GateMode, rationaleRef?: string): string {
  const configPath = path.join(repoDir, MODE_CONFIG_BASENAME);
  // omit-not-empty: rationaleRef is only written when provided (keeps a plain hand-authored
  // {"mode":"advisory"} config byte-stable — the field is additive, not forced).
  const body: Record<string, string> = rationaleRef ? { mode, rationaleRef } : { mode };
  const sorted = Object.keys(body)
    .sort()
    .reduce<Record<string, string>>((acc, k) => ((acc[k] = body[k] as string), acc), {});
  fs.writeFileSync(configPath, JSON.stringify(sorted, null, 2) + '\n');
  return configPath;
}

/**
 * Parse `.blueprints/GRADUATION.md` back into its ceremony entries (in file order). Used to PROVE a
 * downgrade was recorded before it is honored, and by tests asserting the record shape. A missing
 * record parses as an empty list (no ceremonies yet). Tolerant of the human header; it reads only
 * the `## GRADUATE:`/`## DOWNGRADE:` entry blocks.
 */
export function readGraduationRecord(repoDir: string): GraduationEntry[] {
  const recordPath = path.join(repoDir, GRADUATION_RECORD_RELPATH);
  if (!fs.existsSync(recordPath)) return [];
  const text = fs.readFileSync(recordPath, 'utf8');
  const entries: GraduationEntry[] = [];
  const headingRe = /^##\s+(GRADUATE|DOWNGRADE):\s+(enforced|advisory)\s+→\s+(enforced|advisory)\s*$/;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = line.match(headingRe);
    if (m === null) continue;
    const direction: 'graduate' | 'downgrade' = m[1] === 'GRADUATE' ? 'graduate' : 'downgrade';
    const from = m[2] as GateMode;
    const to = m[3] as GateMode;
    // rationale = the non-empty lines after the heading up to the next heading or EOF.
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const bl = lines[j];
      if (bl === undefined) break;
      if (headingRe.test(bl) || /^#\s/.test(bl)) break;
      body.push(bl);
    }
    entries.push({ direction, from, to, rationale: body.join('\n').trim() });
  }
  return entries;
}
