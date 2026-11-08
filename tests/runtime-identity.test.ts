/**
 * Toolchain identity must resolve npm on every supported platform, including when the engine is
 * invoked directly with `node` (no npm user agent in the environment). On Windows npm is a `.cmd`
 * shim that Node refuses to spawn without a shell; before the fix, evidence emission refused there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveToolchainIdentity } from '../src/runtime-identity.js';

describe('resolveToolchainIdentity npm probe', () => {
  let savedUserAgent: string | undefined;
  beforeEach(() => {
    savedUserAgent = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;
  });
  afterEach(() => {
    if (savedUserAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = savedUserAgent;
  });

  it('identifies npm by probing it when no npm user agent is present', () => {
    const identity = resolveToolchainIdentity({
      engineVersion: '0.0.0-test',
      extractorKind: 'ast',
      extractionProfile: 'plugin-surface',
    });
    expect(identity.runtime.npm).toMatch(/^\d+\.\d+\.\d+/);
    expect(identity.runtime.platform).toBe(process.platform);
  });
});
