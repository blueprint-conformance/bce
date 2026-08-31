/**
 * FIXTURE — a NON-ROUTE helper under `src/app/api/**` that extracts ZERO components.
 * Proves the wider `src/app/api/**/*.ts` extraction glob does NOT false-fire on a scanned
 * helper file: no HTTP-verb FunctionDeclaration export → no apiRouteHandler component →
 * nothing for d6-tenant-guard to target; the filename matches no forbiddenFile glob and
 * lives outside every forbiddenPath glob.
 */
export interface TenantRouteParams {
  id: string;
  objectId?: string;
}

export function parseTenantParams(raw: Record<string, string | undefined>): TenantRouteParams {
  if (!raw.id) throw new Error('missing tenant id segment');
  return { id: raw.id, objectId: raw.objectId };
}
