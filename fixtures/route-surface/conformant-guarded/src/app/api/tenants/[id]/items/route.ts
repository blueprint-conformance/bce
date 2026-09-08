/**
 * FIXTURE — conforms to the route-guard blueprint's syntactic call-site check.
 * Each exported handler contains a bare call imported from the configured guard module.
 * A GREEN result does not prove execution on every path, denial propagation, or tenant binding.
 * Direct function declarations and const arrow/function-expression exports are supported.
 */
import { requireTenantAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, items: [] });
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  const body = (await req.json()) as { name?: string };
  return Response.json({ ok: true, tenant: session.tenantId, created: body.name ?? null });
}
