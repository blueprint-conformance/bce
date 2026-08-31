/** FIXTURE — conformant admin-guarded DELETE (see items/route.ts header). */
import { requireTenantAdminAccess } from '@/lib/tenant-guards';

export async function DELETE(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAdminAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, removed: true });
}
