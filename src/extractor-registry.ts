/**
 * The extractor provider registry — the ONE seam that maps a blueprint's extraction PROFILE to
 * the provider that extracts its RepositoryFacts, and the profile-aware front door
 * (`makeExtractor`) the CLI/gate/MCP call.
 *
 * Contract (the extending-extractors guide documents this for the next language):
 *  - each profile names its providers per extractor KIND (`ast` faithful / `line-scan` fallback);
 *  - a single-provider language (python today) registers the SAME provider for both kinds and
 *    DISCLOSES that in `kindNote` — the provider's own `coverage.extractor` reports what actually
 *    ran, so requesting `--extractor ast` on such a profile is inert, never silently upgraded;
 *  - the TypeScript profiles (`next-route-handler`, `plugin-surface`) route to the exact same
 *    constructors the legacy kind-only `makeExtractor` (extractors.ts) builds — byte-identical
 *    facts, proven by the registry verdict-stability test.
 *
 * Import direction (no cycles): this module imports the providers; no provider imports this
 * module.
 */
import type { RepositoryFactsExtractor } from './graph.js';
import type { ExtractionProfile } from './schema.js';
import { AstExtractor, LineScanExtractor, type ResolvedExtraction } from './extractors.js';
import { PythonImportExtractor } from './python-extractor.js';

export interface ExtractorProvider {
  /** which extraction profiles this provider serves */
  profiles: readonly ExtractionProfile[];
  /** the file kinds the provider scans (documentation + registry introspection) */
  fileKinds: readonly string[];
  /** provider note when the requested kind is inert for this profile (single-provider language) */
  kindNote?: string;
  make(kind: 'ast' | 'line-scan', cfg: ResolvedExtraction): RepositoryFactsExtractor;
}

/** The registry table — append a row to add a language provider (widen-only). */
export const EXTRACTOR_PROVIDERS: readonly ExtractorProvider[] = Object.freeze([
  {
    profiles: ['next-route-handler', 'plugin-surface'],
    fileKinds: ['.ts', '.tsx', '.js'],
    make: (kind, cfg) => (kind === 'line-scan' ? new LineScanExtractor(cfg) : new AstExtractor(cfg)),
  },
  {
    profiles: ['python-import-surface'],
    fileKinds: ['.py'],
    kindNote:
      'python has a single line-scan provider; the ast/line-scan flag is inert for this profile ' +
      '(coverage.extractor reports line-scan — see python-extractor.ts for what is and is not detected)',
    make: (_kind, cfg) => new PythonImportExtractor(cfg),
  },
]);

/**
 * The profile-aware extractor front door. For the TypeScript profiles this returns exactly what
 * the legacy kind-only constructor returns (byte-identical facts); for `python-import-surface`
 * it returns the Python provider regardless of the requested kind (disclosed via `kindNote`).
 * An unregistered profile is a programming error (the schema enum and this table must move
 * together) — fail LOUD, never a silent empty scan.
 */
export function makeExtractor(kind: 'ast' | 'line-scan', cfg: ResolvedExtraction): RepositoryFactsExtractor {
  const provider = EXTRACTOR_PROVIDERS.find((p) => p.profiles.includes(cfg.profile));
  if (!provider) {
    throw new Error(
      `no extractor provider registered for profile '${cfg.profile}' — the ExtractionProfileSchema enum and ` +
        `EXTRACTOR_PROVIDERS (extractor-registry.ts) must move together (widen-only)`,
    );
  }
  return provider.make(kind, cfg);
}
