/** FIXTURE — conformant write+admin guarded key routes (see items/route.ts header). */
import { requireTenantWriteAccess, requireTenantAdminAccess } from '@/lib/tenant-guards';

export async function POST(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantWriteAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, issued: 'prefix-only' });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAdminAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, revoked: true });
}
