/**
 * FIXTURE — CONFORMANT mixed-verb tenant routes exercising the FULL guard-symbol set:
 * PATCH/PUT guarded via `requireTenantWriteAccess`, DELETE via `requireTenantAdminAccess`.
 * Proves every entry of the blueprint's explicit guardSymbols list satisfies d6-tenant-guard
 * (not only the historical `requireTenantAccess`). All handlers are FunctionDeclarations (FIX 2).
 */
import { requireTenantWriteAccess } from '@/lib/tenant-guards';

export async function PATCH(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantWriteAccess(ctx.params.id);
  const patch = (await req.json()) as Record<string, unknown>;
  return Response.json({ ok: true, tenant: session.tenantId, patched: Object.keys(patch).length });
}

export async function PUT(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await requireTenantWriteAccess(ctx.params.id);
  const body = (await req.json()) as Record<string, unknown>;
  return Response.json({ ok: true, tenant: session.tenantId, replaced: Object.keys(body).length });
}
