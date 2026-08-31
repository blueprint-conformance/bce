/**
 * FIXTURE — a CONFORMANT tenant-scoped route (route-guard blueprint, next-route-handler profile).
 *
 * Every exported HTTP-verb handler calls a BARE tenant-guard symbol (`requireTenantAccess`) —
 * the exact per-tenant-ownership-invariant shape the d6-tenant-guard constraint
 * requires. The route-guard blueprint scores this GREEN.
 *
 * FIXTURE-AUTHORING PIN (review FIX 2): handlers are authored as
 * `export async function VERB(...)` FunctionDeclarations — the ONLY shape
 * extractRouteHandler extracts. An exported-const arrow handler extracts ZERO components.
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
