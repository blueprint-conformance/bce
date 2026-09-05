/**
 * The solo-maintainer operating model is executable without pretending automation is review.
 * These tests bind the public 168-hour claim, human-response definition, label catalog, issue
 * forms, PR template, and read-only workflow to the checked-in policy.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  evaluateTriageSlo,
  parseTriagePolicy,
  renderTriageResult,
} from '../scripts/triage-slo.mjs';
import {
  findMissingLabels,
  inspectContributorOperations,
  validateLabelCatalog,
} from '../scripts/verify-contributor-operations.mjs';

const ROOT = join(__dirname, '..');
const POLICY = {
  schemaVersion: 1,
  effectiveFrom: '2026-09-05T00:00:00Z',
  maxFirstResponseHours: 168,
  maintainerActorIds: [243248197],
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    number: 41,
    kind: 'issue',
    title: 'External report',
    url: 'https://github.com/blueprint-conformance/bce/issues/41',
    authorId: 9001,
    createdAt: '2026-09-05T01:00:00Z',
    comments: [],
    reviews: [],
    ...overrides,
  };
}

describe('solo-maintainer first-response SLO', () => {
  it('keeps a new external item visible inside the 168-hour window', () => {
    const result = evaluateTriageSlo(POLICY, [item()], '2026-09-06T01:00:00Z');
    expect(result.pending).toHaveLength(1);
    expect(result.overdue).toHaveLength(0);
  });

  it('fails an external item with no maintainer response after the deadline', () => {
    const result = evaluateTriageSlo(POLICY, [item()], '2026-09-13T01:00:01Z');
    expect(result.overdue).toHaveLength(1);
    expect(renderTriageResult(result, POLICY)).toContain('triage-slo: FAIL');
  });

  it('counts a configured human maintainer comment inside the window', () => {
    const result = evaluateTriageSlo(POLICY, [item({
      comments: [{ authorId: 243248197, createdAt: '2026-09-05T03:00:00Z' }],
    })], '2026-09-13T01:00:01Z');
    expect(result.onTime).toHaveLength(1);
    expect(result.onTime[0].responseHours).toBe(2);
  });

  it('counts a submitted maintainer review but not contributor or bot chatter', () => {
    const result = evaluateTriageSlo(POLICY, [item({
      kind: 'pull request',
      comments: [
        { authorId: 9001, createdAt: '2026-09-05T02:00:00Z' },
        { authorId: 41898282, createdAt: '2026-09-05T02:01:00Z' },
      ],
      reviews: [{ authorId: 243248197, createdAt: '2026-09-06T01:00:00Z' }],
    })], '2026-09-13T01:00:01Z');
    expect(result.onTime).toHaveLength(1);
    expect(result.onTime[0].responseHours).toBe(24);
  });

  it('records a late response without erasing its public miss', () => {
    const result = evaluateTriageSlo(POLICY, [item({
      comments: [{ authorId: 243248197, createdAt: '2026-09-12T02:00:00Z' }],
    })], '2026-09-13T01:00:01Z');
    expect(result.late).toHaveLength(1);
    expect(result.overdue).toHaveLength(0);
    expect(renderTriageResult(result, POLICY)).toContain('1 late');
  });

  it('does not manufacture a response obligation for maintainer-authored tracking items', () => {
    const result = evaluateTriageSlo(POLICY, [item({ authorId: 243248197 })], '2026-09-20T00:00:00Z');
    expect(result.ignored).toHaveLength(1);
    expect(result.overdue).toHaveLength(0);
  });

  it('refuses malformed policy instead of silently disabling the window', () => {
    expect(() => parseTriagePolicy({ ...POLICY, maxFirstResponseHours: 0 })).toThrow('positive integer');
    expect(() => parseTriagePolicy({ ...POLICY, maintainerActorIds: [] })).toThrow('at least one positive maintainer actor ID');
    expect(() => parseTriagePolicy({ ...POLICY, effectiveFrom: 'eventually' })).toThrow('ISO-8601');
  });
});

describe('contributor operations contract', () => {
  it('keeps forms, Dependabot, queue policy, PR template, and read-only workflow synchronized', () => {
    const result = inspectContributorOperations(ROOT);
    expect(result.failures).toEqual([]);
    expect(result.referencedLabels).toContain('status:needs-triage');
    expect(result.referencedLabels).toContain('security');
    expect(result.catalog.labels).toHaveLength(21);
    const catalogNames = result.catalog.labels.map((label: { name: string }) => label.name);
    for (const documented of [
      'false-verdict', 'quickstart', 'documentation', 'corpus-candidate', 'extractor-python',
      'spec', 'question', 'wontfix-scope',
    ]) {
      expect(catalogNames).toContain(documented);
    }
  });

  it('refuses missing or duplicate canonical labels', () => {
    expect(findMissingLabels(new Set(['bug']), ['bug', 'status:needs-triage'])).toEqual(['status:needs-triage']);
    expect(validateLabelCatalog({
      schemaVersion: 1,
      labels: [
        { name: 'bug', color: 'd73a4a', description: 'First definition' },
        { name: 'BUG', color: 'xyz', description: 'duplicate' },
      ],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("duplicates 'BUG'"),
      expect.stringContaining('six hexadecimal characters'),
    ]));
  });
});
