/**
 * SEEDED-DEFECT FIXTURE (rg-decoy-guard-local) — the same-name local-function evasion.
 *
 * The handler calls a local no-op named `requireTenantAccess`, not the governed imported guard.
 * Name matching alone must never create a `guards` edge.
 */
async function requireTenantAccess(tenantId: string): Promise<{ tenantId: string }> {
  return { tenantId };
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  // DRIFT: same spelling, local provenance — must NOT be credited.
  const session = await requireTenantAccess(ctx.params.id);
  const body = (await req.json()) as { plan?: string };
  return Response.json({ ok: true, tenant: session.tenantId, plan: body.plan ?? 'unchanged' });
}
