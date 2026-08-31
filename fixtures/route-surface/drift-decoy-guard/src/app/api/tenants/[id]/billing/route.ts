/**
 * SEEDED-DEFECT FIXTURE (rg-decoy-guard-object) — the decoy-guard evasion (mirror of the
 * extension surface's drift-decoy-register).
 *
 * The handler calls `auth.requireTenantAccess(...)` — a same-name PROPERTY-ACCESS on a local
 * object, NOT the bare imported guard. The extractor's SECURITY-CRITICAL bare-identifier rule
 * (extractRouteHandler: reject `obj.method()`) means NO `guards` edge is credited, so
 * d6-tenant-guard fires on `route:billing:POST` precisely because the governed path was not taken.
 */
import { auth } from '@/lib/auth';

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  // DRIFT: a decoy object's same-name method — ungoverned provenance, must NOT be credited.
  const session = await auth.requireTenantAccess(ctx.params.id);
  const body = (await req.json()) as { plan?: string };
  return Response.json({ ok: true, tenant: session.tenantId, plan: body.plan ?? 'unchanged' });
}
