import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import { parseBlueprint } from '../src/schema.js';
import { evaluate } from '../src/report.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const blueprint = parseBlueprint(JSON.parse(readFileSync('fixtures/route-guard.blueprint.json', 'utf8')));
const prefix = "import { requireTenantAccess } from '@/lib/tenant-guards';\n";
const guarded = 'await requireTenantAccess(tenant); return { secret: true };';
function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'bce-route-evidence-')); roots.push(root);
  // Keep the published blueprint unchanged, including its three-file coverage floor.
  for (const [name, body] of [['items', source], ['projects', `export async function GET(tenant) { ${guarded} }`],
    ['settings', `export async function GET(tenant) { ${guarded} }`]]) {
    const file = join(root, `src/app/api/tenants/[id]/${name}/route.ts`);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, prefix + body);
  }
  mkdirSync(join(root, '.blueprints'));
  writeFileSync(join(root, '.blueprints/route-guard.blueprint.json'), JSON.stringify(blueprint));
  return root;
}
function inspect(source: string) {
  const root = fixture(source);
  const graph = new AstExtractor(resolveExtraction(blueprint.extraction, blueprint.constraints)).extract(root, 'test');
  return { root, graph, report: evaluate(blueprint, graph) };
}
const forms = [
  (verb: string, body: string) => `export async function ${verb}(tenant) { ${body} }`,
  (verb: string, body: string) => `export const ${verb} = async (tenant) => { ${body} };`,
  (verb: string, body: string) => `export const ${verb} = async function(tenant) { ${body} };`,
];
const verbs = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
describe('route inventory and governed call-site evidence', () => {
  it.each(verbs.flatMap(verb => forms.map((form, shape) => ({ verb, shape, form }))))(
    'detects a missing guard for $verb shape $shape alongside healthy handlers', ({ verb, form }) => {
      const positive = inspect(form(verb, guarded));
      expect(positive.report.verdict).toBe('pass');
      const negative = inspect(form(verb, 'return { secret: true };'));
      expect(negative.graph.components).toHaveLength(3);
      expect(negative.report.verdict).toBe('fail');
      expect(negative.report.violations.some(v => v.constraintId === 'd6-tenant-guard' && v.component.endsWith(`:${verb}`))).toBe(true);
    });
  it('inventories a POST arrow alongside a guarded GET in the same file', () => {
    const { graph, report } = inspect(forms[0]!('GET', guarded) + '\n' + forms[1]!('POST', 'return {};'));
    expect(graph.components).toHaveLength(4);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.component).toMatch(/:POST$/);
  });
  it('supports transparent TypeScript wrappers and expression-bodied arrows', () => {
    expect(inspect('export const GET = ((async (tenant) => requireTenantAccess(tenant)) satisfies Handler);').report.verdict).toBe('pass');
  });
  it('allows empty exports, type exports, and unrelated destructured bindings', () => {
    expect(inspect(forms[0]!('GET', guarded) + '\nexport {}; export type { POST } from \"./types\"; export const { GET: config } = settings;').report.verdict).toBe('pass');
  });
  it('does not confuse a default function name with a named HTTP export', () => {
    expect(inspect('export default async function GET() { return {}; }').graph.components).toHaveLength(2);
  });
  it.each([
    'export const POST = withGuard(handler);',
    'export let POST = async () => {};',
    'const handler = async () => {}; export { handler as POST };',
    "export { POST } from './other';",
    'const handler = async () => {}; export { handler as "POST" };',
    "export * from './other';",
    "export * as POST from './other';",
    'export const { POST } = handlers;',
    'export const { methods: { action: POST } } = handlers;',
    'export const [POST] = handlers;',
    'export class POST {}',
    'export declare function POST(): void;',
  ])('refuses unresolved export even with a healthy GET: %s', source => {
    expect(() => inspect(forms[0]!('GET', guarded) + '\n' + source)).toThrow(/unsupported route export at .*route.ts#L\d+/);
  });
  it('does not accept a local decoy or an import from an ungoverned module', () => {
    for (const source of [
      'export async function GET() { const requireTenantAccess = () => {}; requireTenantAccess(); }',
      "import { fakeGuard } from 'untrusted'; export async function GET() { fakeGuard(); }",
    ]) expect(inspect(source).report.verdict).toBe('fail');
  });
});

// These are LIMIT witnesses, not conformant authorization examples. Green asserts only the
// documented syntactic predicate; the same report must explicitly mark behavior unverified.
const limitations = [
  ['conditional', 'if (false) await requireTenantAccess(tenant); return { secret: true };'],
  ['unreachable', 'return { secret: true }; await requireTenantAccess(tenant);'],
  ['uncalled nested function', 'async function unused() { await requireTenantAccess(tenant); } return { secret: true };'],
  ['swallowed denial', 'try { await requireTenantAccess(tenant); } catch {} return { secret: true };'],
  ['wrong tenant', "await requireTenantAccess('different-tenant'); return { secret: true };"],
  ['unawaited', 'requireTenantAccess(tenant); return { secret: true };'],
] as const;
describe('explicit semantic limits — a call-site pass is not access enforcement', () => {
  it.each(limitations)('%s remains visibly unverified', (_name, body) => {
    const { report } = inspect(forms[0]!('GET', body));
    expect(report.verdict).toBe('pass');
    expect(report.summary).toContain('authorization behavior unverified');
    expect(report.coverage.unsupported.join(' ')).toContain('tenant/resource binding');
  });
  it.each(limitations.filter(([name]) => name !== 'unawaited'))('%s can return data under a denying guard contract', async (_name, body) => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const guard = async (tenant: string) => { if (tenant !== 'different-tenant') throw new Error('ACCESS_DENIED'); };
    await expect(new AsyncFunction('requireTenantAccess', 'tenant', guarded)(guard, 'requested-tenant')).rejects.toThrow('ACCESS_DENIED');
    await expect(new AsyncFunction('requireTenantAccess', 'tenant', body)(guard, 'requested-tenant')).resolves.toEqual({ secret: true });
  });
});
describe('real CLI enforced gate', () => {
  it.each([
    [forms[1]!('POST', guarded), 0, 'pass'],
    [forms[0]!('GET', guarded) + forms[1]!('POST', 'return {};'), 1, 'violation'],
    [forms[0]!('GET', guarded) + 'export const POST = withGuard(handler);', 2, 'refusal'],
  ] as const)('returns exit %s with machine-readable evidence', (source, exitCode, outcome) => {
    const root = fixture(source), output = join(root, 'gate.json');
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'gate', '--repo', root,
      '--repo-name', 'service-beta', '--report-json', output], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(exitCode);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.outcome).toBe(outcome);
    expect(report.exitCode).toBe(exitCode);
    if (exitCode === 0) expect(report.reports[0].summary).toContain('authorization behavior unverified');
    if (exitCode === 2) expect(report.refusals.join(' ')).toContain('unsupported route export');
  });
});
