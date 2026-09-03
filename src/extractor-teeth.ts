/** Real-source mutation proof for extractor-observed blueprint teeth. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { makeExtractor } from './extractor-registry.js';
import { resolveExtraction, sourceSyntaxDiagnostics } from './extractors.js';
import { evaluate, stableStringify } from './report.js';
import type { EngineeringBlueprint } from './schema.js';

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePath = z.string().min(1).refine(
  (value) => !path.isAbsolute(value) && !value.replace(/\\/g, '/').split('/').includes('..'),
  'must be a traversal-free repository-relative path',
);

const MutationOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('appendText'), target: RelativePath, preconditionSha256: Hex64, content: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('replaceText'), target: RelativePath, preconditionSha256: Hex64, find: z.string().min(1), replacement: z.string() }).strict(),
  z.object({ kind: z.literal('createFile'), target: RelativePath, preconditionSha256: z.null(), content: z.string() }).strict(),
  z.object({ kind: z.literal('deleteFile'), target: RelativePath, preconditionSha256: Hex64 }).strict(),
]);

export const TeethMutationManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  blueprintRef: z.string().min(3),
  allowedMutationRoots: z.array(RelativePath).min(1),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/),
    constraintId: z.string().min(1),
    operation: MutationOperationSchema,
    expectedEvidencePath: RelativePath,
    allowedCollateralConstraints: z.array(z.string().min(1)).default([]),
  }).strict()).min(1),
}).strict();

export type TeethMutationManifest = z.infer<typeof TeethMutationManifestSchema>;

export interface ExtractorTeethCaseResult {
  id: string;
  constraintId: string;
  mutationTarget: string;
  preconditionSha256: string | null;
  mutatedSha256: string | null;
  targetViolations: string[];
  unexpectedCollateralConstraints: string[];
  status: 'killed' | 'survived' | 'refused';
  detail: string;
}

export interface ExtractorTeethReport {
  schemaVersion: '1';
  blueprintRef: string;
  extractor: 'ast' | 'line-scan';
  cleanVerdict: 'pass' | 'fail';
  constraints: number;
  mapped: number;
  killed: number;
  survived: number;
  refused: number;
  unmappedConstraints: string[];
  duplicateMappings: string[];
  inputBindings: {
    sourceTreeSha256: string;
    blueprintSha256: string;
    mutationManifestSha256: string;
    extractorIdentity: string;
    nodeVersion: string;
  };
  cases: ExtractorTeethCaseResult[];
  verdict: 'extractor-real-proven' | 'refusal';
  proofSha256: string;
}

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function selectedRoots(repo: string, roots: readonly string[]): Array<{ relative: string; absolute: string }> {
  const root = fs.realpathSync(repo);
  const selected = [...new Set(roots.map((value) => normalized(value).replace(/\/\*\*$/, '')))].sort();
  const minimal = selected.filter((value) => !selected.some((other) => value !== other && value.startsWith(`${other}/`)));
  return minimal.map((relative) => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`allowed mutation root '${relative}' escapes repository`);
    return { relative, absolute };
  });
}

function sourceTreeSha256(repo: string, roots: readonly string[]): string {
  const root = fs.realpathSync(repo);
  const entries: Array<{ path: string; sha256: string }> = [];
  const walk = (absolute: string): void => {
    if (!fs.existsSync(absolute)) {
      entries.push({ path: path.relative(root, absolute).split(path.sep).join('/'), sha256: sha256('missing') });
      return;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push({ path: path.relative(root, absolute).split(path.sep).join('/'), sha256: sha256(`symlink:${fs.readlinkSync(absolute)}`) });
      return;
    }
    if (stat.isFile()) {
      entries.push({ path: path.relative(root, absolute).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(absolute)) });
      return;
    }
    if (!stat.isDirectory()) throw new Error(`governed source tree contains unsupported entry: ${path.relative(root, absolute)}`);
    for (const name of fs.readdirSync(absolute).sort()) {
      if (['.git', 'node_modules', 'dist', 'coverage'].includes(name)) continue;
      walk(path.join(absolute, name));
    }
  };
  for (const selected of selectedRoots(repo, roots)) walk(selected.absolute);
  return sha256(stableStringify(entries));
}

function normalized(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function isUnderAllowedRoot(target: string, roots: readonly string[]): boolean {
  const t = normalized(target);
  return roots.some((root) => {
    const r = normalized(root).replace(/\/\*\*$/, '');
    return t === r || t.startsWith(`${r}/`);
  });
}

const PROTECTED_PREFIXES = ['.blueprints', '.github', '.agents', '.codex', '.claude', '.cursor', 'tests', 'test', '__tests__', 'spec'];
const PROTECTED_FILES = new Set(['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.mcp.json', '.bce-mode.json', '.bce-adoption.json', '.engine-pin.json']);

function mutationTarget(repo: string, manifest: TeethMutationManifest, target: string): string {
  if (!isUnderAllowedRoot(target, manifest.allowedMutationRoots)) throw new Error(`target '${target}' is outside allowedMutationRoots`);
  const n = normalized(target);
  if (PROTECTED_FILES.has(n) || PROTECTED_PREFIXES.some((prefix) => n === prefix || n.startsWith(`${prefix}/`))) {
    throw new Error(`target '${target}' is a protected policy/test surface`);
  }
  const root = fs.realpathSync(repo);
  // Resolve from the canonical root. On macOS, temporary directories commonly
  // enter through /var but realpath to /private/var; mixing those forms makes a
  // valid descendant look like an escape.
  const candidate = path.resolve(root, target);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error(`target '${target}' escapes repository`);
  let cursor = root;
  for (const segment of normalized(target).split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`target '${target}' traverses a symbolic link`);
    }
  }
  const existingBoundary = fs.existsSync(candidate) ? fs.realpathSync(candidate) : fs.realpathSync(path.dirname(candidate));
  if (existingBoundary !== root && !existingBoundary.startsWith(`${root}${path.sep}`)) throw new Error(`target '${target}' resolves outside repository`);
  return candidate;
}

function assertParseable(target: string, content: string): void {
  if (!/\.[cm]?[jt]sx?$/.test(target)) return;
  const diagnostics = sourceSyntaxDiagnostics(target, content);
  if (diagnostics.length > 0) throw new Error(`mutation is not parseable: ${diagnostics.join('; ')}`);
}

function copySourceTree(source: string, target: string, roots: readonly string[]): void {
  for (const selected of selectedRoots(source, roots)) {
    if (!fs.existsSync(selected.absolute)) continue;
    const destination = path.join(target, selected.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(selected.absolute, destination, {
      recursive: true,
      filter: (entry) => !entry.split(path.sep).some((part) => ['.git', 'node_modules', 'dist', 'coverage'].includes(part)),
    });
  }
}

function applyOperation(repo: string, manifest: TeethMutationManifest, operation: z.infer<typeof MutationOperationSchema>): { before: string | null; after: string | null } {
  const target = mutationTarget(repo, manifest, operation.target);
  const exists = fs.existsSync(target);
  if (operation.kind === 'createFile') {
    if (exists) throw new Error(`createFile target already exists: ${operation.target}`);
    assertParseable(operation.target, operation.content);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, operation.content);
    return { before: null, after: sha256(fs.readFileSync(target)) };
  }
  if (!exists || !fs.statSync(target).isFile()) throw new Error(`mutation target is not an existing file: ${operation.target}`);
  const bytes = fs.readFileSync(target);
  const before = sha256(bytes);
  if (before !== operation.preconditionSha256) throw new Error(`precondition digest mismatch for ${operation.target}`);
  if (operation.kind === 'deleteFile') {
    fs.unlinkSync(target);
    return { before, after: null };
  }
  const text = bytes.toString('utf8');
  if (operation.kind === 'appendText') fs.writeFileSync(target, `${text}${operation.content}`);
  else {
    const first = text.indexOf(operation.find);
    if (first < 0 || text.indexOf(operation.find, first + operation.find.length) >= 0) {
      throw new Error(`replaceText find must occur exactly once in ${operation.target}`);
    }
    fs.writeFileSync(target, `${text.slice(0, first)}${operation.replacement}${text.slice(first + operation.find.length)}`);
  }
  const after = sha256(fs.readFileSync(target));
  if (after === before) throw new Error(`mutation is a no-op for ${operation.target}`);
  assertParseable(operation.target, fs.readFileSync(target, 'utf8'));
  return { before, after };
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function assessExtractorTeethCorpus(input: {
  blueprint: EngineeringBlueprint;
  repoDir: string;
  manifest: unknown;
  extractor?: 'ast' | 'line-scan';
}): ExtractorTeethReport {
  const manifest = TeethMutationManifestSchema.parse(input.manifest);
  const extractorKind = input.extractor ?? 'ast';
  const blueprintRef = `${input.blueprint.metadata.id}@${input.blueprint.metadata.version}`;
  if (manifest.blueprintRef !== blueprintRef) throw new Error(`mutation manifest blueprintRef ${manifest.blueprintRef} does not match ${blueprintRef}`);
  const cfg = resolveExtraction(input.blueprint.extraction, input.blueprint.constraints);
  const extractor = makeExtractor(extractorKind, cfg);
  const cleanGraph = extractor.extract(input.repoDir, 'extractor-teeth:clean');
  const cleanReport = evaluate(input.blueprint, cleanGraph, cfg.profile);
  const constraints = input.blueprint.constraints.map((constraint) => constraint.id).sort();
  const mappingCounts = countValues(manifest.cases.map((entry) => entry.constraintId));
  const unmappedConstraints = constraints.filter((id) => !mappingCounts.has(id));
  const duplicateMappings = [...mappingCounts].filter(([, count]) => count !== 1).map(([id]) => id).sort();
  const unknownMappings = [...mappingCounts.keys()].filter((id) => !constraints.includes(id));
  duplicateMappings.push(...unknownMappings.map((id) => `unknown:${id}`));
  duplicateMappings.sort();
  const results: ExtractorTeethCaseResult[] = [];
  for (const testCase of [...manifest.cases].sort((a, b) => a.constraintId.localeCompare(b.constraintId))) {
    const targetConstraint = input.blueprint.constraints.find((constraint) => constraint.id === testCase.constraintId);
    if (!targetConstraint) {
      results.push({ id: testCase.id, constraintId: testCase.constraintId, mutationTarget: testCase.operation.target, preconditionSha256: null, mutatedSha256: null, targetViolations: [], unexpectedCollateralConstraints: [], status: 'refused', detail: 'constraint is not present in blueprint' });
      continue;
    }
    const cleanTargetViolations = cleanReport.violations.filter((violation) => violation.constraintId === testCase.constraintId);
    if (cleanTargetViolations.length > 0) {
      results.push({ id: testCase.id, constraintId: testCase.constraintId, mutationTarget: testCase.operation.target, preconditionSha256: null, mutatedSha256: null, targetViolations: cleanTargetViolations.map((violation) => violation.evidenceRef), unexpectedCollateralConstraints: [], status: 'refused', detail: 'target constraint is already RED on the clean tree' });
      continue;
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `bce-extractor-teeth-${testCase.id}-`));
    try {
      copySourceTree(input.repoDir, scratch, manifest.allowedMutationRoots);
      const mutation = applyOperation(scratch, manifest, testCase.operation);
      const mutatedGraph = extractor.extract(scratch, `extractor-teeth:${testCase.id}`);
      const mutatedReport = evaluate(input.blueprint, mutatedGraph, cfg.profile);
      const targetViolations = mutatedReport.violations.filter((violation) => violation.constraintId === testCase.constraintId);
      const exactEvidence = targetViolations.filter((violation) => violation.evidenceRef.startsWith(`${normalized(testCase.expectedEvidencePath)}#L`));
      const unexpected = [...new Set(mutatedReport.violations
        .map((violation) => violation.constraintId)
        .filter((id) => id !== testCase.constraintId && !testCase.allowedCollateralConstraints.includes(id)))].sort();
      const killed = targetViolations.length > 0 && exactEvidence.length === targetViolations.length && unexpected.length === 0;
      results.push({
        id: testCase.id,
        constraintId: testCase.constraintId,
        mutationTarget: testCase.operation.target,
        preconditionSha256: mutation.before,
        mutatedSha256: mutation.after,
        targetViolations: targetViolations.map((violation) => violation.evidenceRef).sort(),
        unexpectedCollateralConstraints: unexpected,
        status: unexpected.length > 0 ? 'refused' : killed ? 'killed' : 'survived',
        detail: killed ? 'real mutated source was observed by the extractor and reddened the mapped constraint at the expected file' :
          unexpected.length > 0 ? `mutation reddened undeclared collateral constraints: ${unexpected.join(', ')}` :
          targetViolations.length === 0 ? 'real source mutation did not redden the mapped constraint' : 'constraint reddened, but evidence did not point at the mutated source path',
      });
    } catch (error) {
      results.push({ id: testCase.id, constraintId: testCase.constraintId, mutationTarget: testCase.operation.target, preconditionSha256: null, mutatedSha256: null, targetViolations: [], unexpectedCollateralConstraints: [], status: 'refused', detail: (error as Error).message });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  const killed = results.filter((entry) => entry.status === 'killed').length;
  const survived = results.filter((entry) => entry.status === 'survived').length;
  const refused = results.filter((entry) => entry.status === 'refused').length;
  const proven = cleanReport.verdict === 'pass' && unmappedConstraints.length === 0 && duplicateMappings.length === 0 &&
    killed === constraints.length && survived === 0 && refused === 0;
  const body = {
    schemaVersion: '1' as const,
    blueprintRef,
    extractor: extractorKind,
    cleanVerdict: cleanReport.verdict,
    constraints: constraints.length,
    mapped: mappingCounts.size,
    killed,
    survived,
    refused,
    unmappedConstraints,
    duplicateMappings,
    inputBindings: {
      sourceTreeSha256: sourceTreeSha256(input.repoDir, manifest.allowedMutationRoots),
      blueprintSha256: sha256(stableStringify(input.blueprint)),
      mutationManifestSha256: sha256(stableStringify(manifest)),
      extractorIdentity: extractorKind === 'ast' ? 'bce-ast:ts-morph@23.0.0' : 'bce-line-scan:v1',
      nodeVersion: process.version,
    },
    cases: results,
    verdict: proven ? 'extractor-real-proven' as const : 'refusal' as const,
  };
  return { ...body, proofSha256: sha256(stableStringify(body)) };
}
