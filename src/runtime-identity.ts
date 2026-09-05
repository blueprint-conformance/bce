import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExtractionProfile } from './schema.js';

declare const __BCE_DEPENDENCY_LOCK_SHA256__: string;

function dependencyLockSha256(): string {
  if (typeof __BCE_DEPENDENCY_LOCK_SHA256__ !== 'undefined') return __BCE_DEPENDENCY_LOCK_SHA256__;
  const lock = fileURLToPath(new URL('../npm-shrinkwrap.json', import.meta.url));
  return createHash('sha256').update(readFileSync(lock)).digest('hex');
}

export interface ToolchainIdentity {
  engine: { name: 'bce-engine'; version: string };
  dependencyLock: { file: 'npm-shrinkwrap.json'; sha256: string };
  runtime: { node: string; npm: string; platform: NodeJS.Platform; arch: string };
  extractor: {
    kind: 'ast' | 'line-scan';
    profile: ExtractionProfile;
    provider: 'typescript-ts-morph' | 'typescript-line-scan' | 'python-line-scan' | 'python-lezer';
    version: string;
  };
}

function npmVersion(): string {
  const fromUserAgent = /(?:^|\s)npm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? '')?.[1];
  if (fromUserAgent) return fromUserAgent;
  try {
    return execFileSync('npm', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('cannot identify npm version for evidence; npm must be available when emitting evidence');
  }
}

export function resolveToolchainIdentity(args: {
  engineVersion: string;
  extractorKind: 'ast' | 'line-scan';
  extractionProfile: ExtractionProfile;
}): ToolchainIdentity {
  const provider = args.extractionProfile === 'python-import-surface'
    ? 'python-line-scan'
    : args.extractionProfile === 'python-module-graph'
      ? 'python-lezer'
      : args.extractorKind === 'ast' ? 'typescript-ts-morph' : 'typescript-line-scan';
  return {
    engine: { name: 'bce-engine', version: args.engineVersion },
    dependencyLock: { file: 'npm-shrinkwrap.json', sha256: dependencyLockSha256() },
    runtime: { node: process.versions.node, npm: npmVersion(), platform: process.platform, arch: process.arch },
    extractor: {
      kind: args.extractorKind,
      profile: args.extractionProfile,
      provider,
      version: args.engineVersion,
    },
  };
}
