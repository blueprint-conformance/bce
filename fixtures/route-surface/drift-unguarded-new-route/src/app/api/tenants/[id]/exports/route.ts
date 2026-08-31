/**
 * SEEDED-DEFECT FIXTURE (rg-unguarded-new-route) — a NEW parallel route ships with GET+POST
 * and ZERO tenant-guard calls, beside guarded existing routes. The exact "new route lands
 * without its tenant-guard edge" shape observed at scale in a real-world fleet incident.
 * d6-tenant-guard must fire EXACTLY TWICE — on `route:exports:GET` + `route:exports:POST` —
 * and the guarded neighbors must stay green in the same report.
 */
import { db } from '@/lib/db';

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  // DRIFT: no guard call — any session can export tenant `ctx.params.id`'s data.
  const rows = await db.exports.list(ctx.params.id);
  return Response.json({ ok: true, rows });
}

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  // DRIFT: no guard call on the write path either.
  const body = (await req.json()) as { format?: string };
  const job = await db.exports.enqueue(ctx.params.id, body.format ?? 'csv');
  return Response.json({ ok: true, job });
}
