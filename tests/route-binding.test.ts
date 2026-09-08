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
const prefix = "import { requireTenantAccess } from '@/lib/tenant-guards';\n";
const guarded = 'export async function GET(tenant) { await requireTenantAccess(tenant); return {}; }';
function fixture(body = '', extension = 'ts') {
  const blueprint = parseBlueprint(JSON.parse(readFileSync('fixtures/route-guard.blueprint.json', 'utf8')));
  blueprint.extraction!.paths = [`src/app/api/**/*.${extension}`];
  blueprint.scope.paths = [`src/app/api/**/*.${extension}`];
  const root = mkdtempSync(join(tmpdir(), 'bce-route-binding-')); roots.push(root);
  for (const name of ['items', 'projects', 'settings']) {
    const file = join(root, `src/app/api/tenants/[id]/${name}/route.${extension}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, prefix + guarded + (name === 'items' ? '\n' + body : ''));
  }
  mkdirSync(join(root, '.blueprints'));
  writeFileSync(join(root, '.blueprints/route-guard.blueprint.json'), JSON.stringify(blueprint));
  return { root, blueprint };
}
function inspect(body = '', extension = 'ts') {
  const { root, blueprint } = fixture(body, extension);
  const graph = new AstExtractor(resolveExtraction(blueprint.extraction, blueprint.constraints)).extract(root, 'test');
  return { graph, report: evaluate(blueprint, graph) };
}

describe('stable route binding evidence', () => {
  it.each([
    'GET = async () => ({});',
    'GET ||= async () => ({});',
    '({ GET } = replacement);',
    '({ handler: GET } = replacement);',
    '({ nested: { GET = replacement } } = replacement);',
    '[GET] = replacement;',
    '[...GET] = replacement;',
    'for (GET of replacements) {}',
    'for ({ GET } of replacements) {}',
    'for (GET in replacements) {}',
    'for (var GET of replacements) {}',
    'for (var { handler: GET } of replacements) {}',
    'var GET = replacement;',
    'var { handler: GET } = replacement;',
    'function replaceLater() { GET = replacement; }',
    'GET++;',
  ])('refuses a located write to the exported binding: %s', source => {
    expect(() => inspect(source)).toThrow(/unsupported route export at .*route.ts#L\d+: handler binding is reassigned/);
  });
  it.each([
    'function configure(GET) { GET = replacement; }',
    'function configure(GET) { ({ GET } = replacement); }',
    'function configure() { let GET; GET = replacement; }',
    'for (const GET of replacements) {}',
    'for (let GET of replacements) {}',
    'var GET;',
    'GET.config = { runtime: "nodejs" };',
    'GET["config"] = {};',
    'const handlers = { GET };',
  ])('preserves shadowed bindings, reads, and properties: %s', source => {
    expect(inspect(source).report.verdict).toBe('pass');
  });
  it('demonstrates the native JavaScript live-export rebinding mechanism', async () => {
    const source = 'const requireTenantAccess = async () => { throw new Error("DENIED"); };\n' + guarded;
    // Native ESM execution, with only the imported guard replaced by a denying test stub.
    const load = (body: string) => import(`data:text/javascript,${encodeURIComponent(body)}`);
    await expect((await load(source)).GET('tenant')).rejects.toThrow('DENIED');
    await expect((await load(source + '\nGET = async () => ({ secret: true });')).GET('tenant'))
      .resolves.toEqual({ secret: true });
  });
});

describe('recognizable CommonJS handler writes refuse at the ESM support boundary', () => {
  it.each([
    'exports.POST = async () => ({});',
    'module.exports.POST = async () => ({});',
    'module.exports = { POST: async () => ({}) };',
    'exports["POST"] = async () => ({});',
    'module["exports"]["POST"] = async () => ({});',
    'module.exports = handlers;',
    '({ handler: exports.POST } = handlers);',
    'delete module.exports.POST;',
    'declare const exports: any; exports.POST = handler;',
  ])('refuses recognizable assignments: %s', source => {
    expect(() => inspect(source)).toThrow(/unsupported route export at .*route.ts#L\d+: CommonJS handler assignment is not supported/);
  });
  it.each([
    'exports.config = {};',
    'module.exports.config = {};',
    'function configure(exports) { exports.POST = handler; }',
    'function configure(module) { module.exports = handlers; }',
    'const exports = {}; exports.POST = handler;',
    'const module = {}; module.exports = handlers;',
  ])('does not misclassify unrelated or shadowed objects: %s', source => {
    expect(inspect(source).report.verdict).toBe('pass');
  });
});

describe('JavaScript routes retain governed import provenance', () => {
  it('observes a healthy .js route surface', () => {
    const { graph, report } = inspect('', 'js');
    expect(graph.components).toHaveLength(3);
    expect(graph.guardEdges).toHaveLength(3);
    expect(report.verdict).toBe('pass');
  });
  it('detects an unguarded JavaScript arrow alongside healthy handlers', () => {
    expect(inspect('export const POST = async () => ({});', 'js').report.verdict).toBe('fail');
  });
  it.each([
    'export const POST = async () => { const requireTenantAccess = () => {}; requireTenantAccess(); };',
    'import { requireTenantAccess as fakeGuard } from "untrusted"; export const POST = async () => { fakeGuard(); };',
  ])('does not credit a local or ungoverned guard: %s', source => {
    expect(inspect(source, 'js').report.verdict).toBe('fail');
  });
  it.each([
    ['', 0, 'pass'],
    ['export const POST = async () => ({});', 1, 'violation'],
    ['GET = async () => ({ secret: true });', 2, 'refusal'],
  ] as const)('uses the real JavaScript CLI gate: %s', (body, exit, outcome) => {
    const { root } = fixture(body, 'js');
    const output = join(root, 'gate.json');
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'gate', '--repo', root,
      '--repo-name', 'service-beta', '--report-json', output], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(exit);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.outcome).toBe(outcome);
    if (exit === 2) expect(report.refusals.join(' ')).toMatch(/route.js#L\d+: handler binding is reassigned/);
  });
});

describe('JavaScript plugin extraction after enabling JavaScript symbol resolution', () => {
  it('retains governed import identity and forbidden import evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'bce-plugin-js-')); roots.push(root);
    const cfg = resolveExtraction({ profile: 'plugin-surface', paths: ['plugin.js'],
      guardSymbols: ['registerTool'], governedModules: ['trusted'], forbiddenImports: ['openai'] });
    for (const [source, expected] of [
      ["import { registerTool } from 'trusted'; export function demoExtension(api) { registerTool(); }", 1],
      ["import { registerTool } from 'untrusted'; export function demoExtension(api) { registerTool(); }", 0],
      ["export function demoExtension(api) { const registerTool = () => {}; registerTool(); }", 0],
    ] as const) {
      writeFileSync(join(root, 'plugin.js'), "import OpenAI from 'openai';\n" + source);
      const graph = new AstExtractor(cfg).extract(root, 'test');
      expect(graph.guardEdges.filter(edge => edge.type === 'provides')).toHaveLength(expected);
      expect(graph.guardEdges.some(edge => edge.type === 'imports' && edge.to === 'openai')).toBe(true);
    }
  });
});
