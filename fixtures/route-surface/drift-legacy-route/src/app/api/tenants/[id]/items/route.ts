/** FIXTURE — guarded neighbor route OUTSIDE legacy/ (must stay GREEN in the drift-legacy-route report). */
import { requireTenantAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, items: [] });
}
