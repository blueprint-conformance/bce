/**
 * SEEDED-DEFECT FIXTURE (rg-mocked-metric-pattern) — mocked-data-in-a-legit-file that no
 * import/path/egress tooth can see. The handler is GUARDED (d6 stays green) and the file lives
 * at a legal path; the drift is ONE line whose content matches the forbiddenPattern regex.
 * The catch must fire via `coverage.patternScan` at the exact file#line — nothing else reddens.
 * (This header deliberately avoids spelling the forbidden call — comments are scanned too.)
 */
import { requireTenantAdminAccess } from '@/lib/tenant-guards';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant') ?? '';
  const session = await requireTenantAdminAccess(tenantId);
  const uptime = Math.random() * 100; // DRIFT: a mocked metric where a real probe belongs
  return Response.json({ ok: true, tenant: session.tenantId, uptime });
}
