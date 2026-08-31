/** FIXTURE — conformant nested object route (see links/route.ts header). */
import { requireTenantAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string; objectId: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, object: ctx.params.objectId });
}
