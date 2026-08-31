/**
 * SEEDED-DEFECT FIXTURE (rg-legacy-route-path) — a GUARDED route placed under the FORBIDDEN
 * `src/app/api/legacy/**` path. Guarded ON PURPOSE so d6-tenant-guard stays green: the report
 * must contain ONLY the forbiddenPath violation (a collateral-noise engine that reddens d6 too
 * makes the (fixture, d6) pair an unseeded false-positive — the anti-collateral contract).
 */
import { requireTenantAccess } from '@/lib/tenant-guards';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant') ?? '';
  const session = await requireTenantAccess(tenantId);
  return Response.json({ ok: true, tenant: session.tenantId, legacy: true });
}
