/** FIXTURE — conformant guarded tenant route (see items/route.ts header). */
import { requireTenantAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, settings: {} });
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  const patch = (await req.json()) as Record<string, unknown>;
  return Response.json({ ok: true, tenant: session.tenantId, applied: Object.keys(patch).length });
}
