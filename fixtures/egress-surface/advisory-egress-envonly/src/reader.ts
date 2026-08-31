/**
 * FIXTURE — coverage-envelope Class B #3: the ENV-ONLY host, no literal fallback.
 *
 * `fetch(`${process.env.LLM_HOST}/v1`)` — the host is a bare `process.env` read with NO literal
 * `||`-chain default. The AST cannot resolve a `process.env.X` PropertyAccessExpression to any host
 * literal (correctly — fail OPEN, never a false BLOCK). A naive scan folds this into an OPAQUE aggregate
 * count (`"N egress call(s) had an unresolvable host and were skipped"`) with no location — a SILENT
 * gap (the declared-honest-coverage invariant): a reviewer could not tell WHERE the unresolvable network call was.
 *
 * The honesty fix ITEMIZES this detected-callee-but-fully-unresolved call in `coverage.unsupported`
 * with its `path#Lnn` + callee — an accurate, AUDITABLE "we saw a network call we could not resolve
 * to a host." It is disclosed as advisory, NEVER a violation (a conformant dynamic reader that reads
 * its host from the environment must never be false-blocked).
 */
export async function callEnvOnly(): Promise<unknown> {
  const res = await fetch(`${process.env.LLM_HOST}/v1/chat/completions`, { method: 'POST' });
  return res.json();
}
