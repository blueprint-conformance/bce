import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlueprint } from './schema.js';
import { discoverBlueprints, runGate, resolveEngineVersion, semverLt } from './gate.js';
import { resolveExtraction } from './extractors.js';
import { makeExtractor } from './extractor-registry.js';
import { assessTeeth } from './teeth.js';
import { resolveMode } from './mode.js';
import { readBaseline } from './baseline.js';

export type DoctorCheckStatus = 'pass' | 'warning' | 'refusal';
export interface DoctorCheck { id: string; status: DoctorCheckStatus; detail: string }
export interface DoctorReport {
  schemaVersion: '1';
  engineVersion: string;
  nodeVersion: string;
  outcome: 'ready' | 'needs-action' | 'refusal';
  exitCode: 0 | 1 | 2;
  checks: DoctorCheck[];
}

function hasTextFile(repoDir: string, candidates: string[], pattern: RegExp): boolean {
  return candidates.some((rel) => {
    const p = path.join(repoDir, rel);
    return fs.existsSync(p) && pattern.test(fs.readFileSync(p, 'utf8'));
  });
}

/** Read-only readiness audit. It mutates nothing and reports every required lifecycle surface. */
export function doctorRepository(repoDir: string, blueprintDir = path.join(repoDir, '.blueprints')): DoctorReport {
  const checks: DoctorCheck[] = [];
  const add = (id: string, status: DoctorCheckStatus, detail: string) => checks.push({ id, status, detail });
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  add('runtime/node', nodeMajor >= 22 ? 'pass' : 'refusal', `Node ${process.versions.node}; required >=22`);
  const engineVersion = resolveEngineVersion();
  add('runtime/engine', engineVersion === '0.0.0' ? 'refusal' : 'pass', `bce-engine ${engineVersion}`);

  const files = discoverBlueprints(blueprintDir);
  add('blueprints/discovery', files.length > 0 ? 'pass' : 'refusal', `${files.length} blueprint(s) discovered`);
  for (const file of files) {
    try {
      const bp = parseBlueprint(JSON.parse(fs.readFileSync(file, 'utf8')));
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = makeExtractor('ast', cfg).extract(repoDir, 'doctor-working-tree');
      if (graph.coverage.filesScanned < cfg.minFiles) {
        add(`blueprint/${bp.metadata.id}/scope`, 'refusal', `scanned ${graph.coverage.filesScanned}, expected >=${cfg.minFiles}`);
        continue;
      }
      add(`blueprint/${bp.metadata.id}/scope`, 'pass', `${graph.coverage.filesScanned} file(s) in scope`);
      const teeth = assessTeeth(bp, graph, cfg.profile);
      add(
        `blueprint/${bp.metadata.id}/proof`,
        teeth.verdict === 'toothed' ? 'pass' : teeth.verdict === 'evaluator-refutable' ? 'warning' : 'refusal',
        `${teeth.verdict}: ${teeth.toothed} extractor-real, ${teeth.evaluatorRefutable} evaluator-only`,
      );
      if (bp.minEngineVersion && semverLt(engineVersion, bp.minEngineVersion)) {
        add(`blueprint/${bp.metadata.id}/engine-pin`, 'refusal', `requires >=${bp.minEngineVersion}, running ${engineVersion}`);
      }
    } catch (e) {
      add(`blueprint/${path.basename(file)}`, 'refusal', (e as Error).message);
    }
  }

  try {
    const mode = resolveMode(repoDir);
    add('policy/mode', mode.explicit ? 'pass' : 'warning', `${mode.mode}${mode.explicit ? ' (committed)' : ' (implicit default)'}`);
  } catch (e) {
    add('policy/mode', 'refusal', (e as Error).message);
  }
  try {
    const baseline = readBaseline(repoDir);
    add('policy/baseline', 'pass', baseline ? `${baseline.entries.length} accepted debt entries` : 'no baseline; all violations enforced');
  } catch (e) {
    add('policy/baseline', 'refusal', (e as Error).message);
  }

  const codeowners = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
  add(
    'governance/codeowners',
    hasTextFile(repoDir, codeowners, /(^|\n)\s*(\*|\.blueprints\/|\.github\/workflows\/).*@/)
      ? 'pass' : 'warning',
    'policy surfaces must have a human-review owner',
  );
  const workflowDir = path.join(repoDir, '.github', 'workflows');
  const workflows = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((x) => /\.ya?ml$/.test(x)).map((x) => path.join(workflowDir, x))
    : [];
  const workflowText = workflows.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  add('ci/gate', /bce(?:-engine)?|blueprint-conformance/.test(workflowText) ? 'pass' : 'warning', `${workflows.length} workflow file(s) inspected`);
  add('ci/exact-pin', /bce-engine@\d+\.\d+\.\d+|blueprint-conformance\/bce@[0-9a-f]{40}/.test(workflowText) ? 'pass' : 'warning', 'CI should use an immutable engine or Action pin');
  add(
    'agents/instructions',
    hasTextFile(repoDir, ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'AGENTS.bce.md'], /bce gate|blueprint conformance/i) ? 'pass' : 'warning',
    'agent done-check instructions',
  );
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { bin?: Record<string, string> };
    add('agents/mcp', packageJson.bin?.['bce-mcp'] ? 'pass' : 'refusal', 'bce-mcp package binary');
  } catch (e) {
    add('agents/mcp', 'refusal', `cannot inspect package MCP binary: ${(e as Error).message}`);
  }

  try {
    const gate = runGate(repoDir, blueprintDir, null, 'ast');
    if (gate.refusals?.length) add('gate/full-sweep', 'refusal', gate.refusals.join('; '));
    else if (gate.reports.some((r) => r.verdict !== 'pass')) add('gate/full-sweep', 'warning', 'gradeable violations exist');
    else add('gate/full-sweep', 'pass', `${gate.blueprintsSelected}/${gate.blueprintsDiscovered} pass`);
  } catch (e) {
    add('gate/full-sweep', 'refusal', (e as Error).message);
  }

  const outcome = checks.some((c) => c.status === 'refusal')
    ? 'refusal' : checks.some((c) => c.status === 'warning') ? 'needs-action' : 'ready';
  return { schemaVersion: '1', engineVersion, nodeVersion: process.versions.node, outcome, exitCode: outcome === 'ready' ? 0 : outcome === 'needs-action' ? 1 : 2, checks };
}
