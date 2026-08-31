/** FIXTURE — fully guarded neighbor route (must stay GREEN in the drift-missing-guard report). */
import { requireTenantAccess, requireTenantWriteAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, projects: [] });
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantWriteAccess(ctx.params.id);
  const body = (await req.json()) as { name?: string };
  return Response.json({ ok: true, tenant: session.tenantId, created: body.name ?? null });
}
