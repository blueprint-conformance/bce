/**
 * SEEDED-DEFECT FIXTURE (rg-missing-tenant-guard) — the missing function-level access
 * control unit shape (CWE-306).
 *
 * GET is guarded; POST validates + queries with NO tenant-guard call at all — the
 * tenant-guard requiredDependency arm must fire EXACTLY ONCE, on this
 * file's POST (`route:items:POST`). Every other handler in the fixture is guarded.
 */
import { requireTenantAccess } from '@/lib/tenant-guards';
import { db } from '@/lib/db';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, items: [] });
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  // DRIFT: validates the body and queries the store, but NEVER calls a tenant guard —
  // any authenticated session can write into tenant `ctx.params.id` (CWE-306 shape).
  const body = (await req.json()) as { name?: string };
  if (!body.name) {
    return Response.json({ ok: false, error: 'name required' }, { status: 400 });
  }
  const created = await db.items.create({ tenantId: ctx.params.id, name: body.name });
  return Response.json({ ok: true, created });
}
