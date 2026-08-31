/**
 * FIXTURE — CONFORMANT deep-nested tenant route (`[id]/[objectId]`-style segments).
 * Proves the wider `src/app/api/**` glob + segment-bracket component ids work end-to-end.
 * All handlers are FunctionDeclarations (FIX 2), all guarded.
 */
import { requireTenantAccess, requireTenantWriteAccess } from '@/lib/tenant-guards';

export async function GET(_req: Request, ctx: { params: { id: string; objectId: string } }): Promise<Response> {
  const session = await requireTenantAccess(ctx.params.id);
  return Response.json({ ok: true, tenant: session.tenantId, object: ctx.params.objectId, links: [] });
}

export async function POST(req: Request, ctx: { params: { id: string; objectId: string } }): Promise<Response> {
  const session = await requireTenantWriteAccess(ctx.params.id);
  const body = (await req.json()) as { target?: string };
  return Response.json({ ok: true, tenant: session.tenantId, linked: body.target ?? null });
}
