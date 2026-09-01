import * as path from 'node:path';

export type PolicyChangeClass = 'code-repair' | 'policy-change' | 'policy-relaxation';
export interface FileChange { path: string; before?: string; after?: string }
export interface ClassifiedChange { path: string; classification: PolicyChangeClass; reasons: string[] }
export interface PolicyChangeReport {
  schemaVersion: '1';
  classification: PolicyChangeClass;
  humanOwnerReviewRequired: boolean;
  changes: ClassifiedChange[];
}

const POLICY_PATHS = [
  /^\.blueprints\//, /^\.bce-mode\.json$/, /^\.bce-adoption\.json$/, /^\.engine-pin\.json$/,
  /^\.github\/workflows\//, /^CODEOWNERS$/, /^action\.yml$/, /^spec\/schemas\//,
  /^CITATION\.cff$/, /^GOVERNANCE\.md$/, /^SECURITY\.md$/, /^package\.json$/,
];
const rank: Record<PolicyChangeClass, number> = { 'code-repair': 0, 'policy-change': 1, 'policy-relaxation': 2 };

function json(text?: string): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v as Record<string, unknown> : undefined; }
  catch { return undefined; }
}

function blueprintRelaxed(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const b = (before.constraints as Array<Record<string, unknown>> | undefined) ?? [];
  const a = (after.constraints as Array<Record<string, unknown>> | undefined) ?? [];
  const afterIds = new Set(a.map((c) => c.id));
  const removed = b.filter((c) => !afterIds.has(c.id)).map((c) => String(c.id));
  if (removed.length) reasons.push(`constraint removed: ${removed.join(', ')}`);
  const severity = ['info', 'low', 'medium', 'high', 'critical'];
  const byId = new Map(a.map((c) => [c.id, c]));
  for (const old of b) {
    const next = byId.get(old.id);
    if (next && severity.indexOf(String(next.severity)) < severity.indexOf(String(old.severity))) {
      reasons.push(`severity lowered: ${String(old.id)}`);
    }
  }
  return reasons;
}

/** Conservative semantic classifier. Ambiguous edits remain policy-change; known weakening is relaxation. */
export function classifyPolicyChanges(files: readonly FileChange[]): PolicyChangeReport {
  const changes = files.map((file): ClassifiedChange => {
    const rel = file.path.split(path.sep).join('/').replace(/^\.\//, '');
    if (!POLICY_PATHS.some((p) => p.test(rel))) return { path: rel, classification: 'code-repair', reasons: ['non-policy path'] };
    const reasons = ['protected policy surface changed'];
    let classification: PolicyChangeClass = 'policy-change';
    const before = json(file.before);
    const after = json(file.after);
    if (rel === '.bce-mode.json' && before?.mode === 'enforced' && after?.mode === 'advisory') {
      classification = 'policy-relaxation'; reasons.push('mode changed enforced -> advisory');
    }
    if (rel === '.blueprints/baseline.json') {
      const oldIds = new Set(((before?.entries as Array<{ id?: string }> | undefined) ?? []).map((e) => e.id));
      const added = ((after?.entries as Array<{ id?: string }> | undefined) ?? []).filter((e) => !oldIds.has(e.id));
      if (file.before === undefined || added.length > 0) {
        classification = 'policy-relaxation'; reasons.push(file.before === undefined ? 'baseline created' : `${added.length} baseline entr${added.length === 1 ? 'y' : 'ies'} added`);
      }
    }
    if (/\.blueprint\.json$/.test(rel) && before && after) {
      const relaxed = blueprintRelaxed(before, after);
      if (relaxed.length) { classification = 'policy-relaxation'; reasons.push(...relaxed); }
    }
    if (/^\.github\/workflows\//.test(rel) && file.after === undefined) {
      classification = 'policy-relaxation'; reasons.push('governance workflow deleted');
    }
    return { path: rel, classification, reasons };
  });
  const classification = changes.reduce<PolicyChangeClass>((acc, c) => rank[c.classification] > rank[acc] ? c.classification : acc, 'code-repair');
  return { schemaVersion: '1', classification, humanOwnerReviewRequired: classification !== 'code-repair', changes };
}
