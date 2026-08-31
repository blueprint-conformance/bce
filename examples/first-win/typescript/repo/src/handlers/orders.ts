/**
 * Order lookup handler.
 *
 * This file carries the seeded violation for the typescript first win: it builds a
 * SQL string by interpolating a caller-supplied value straight into the query text.
 * The project's data-access rule says otherwise — see the walkthrough in ../../README.md.
 */
import { getPool } from '../db.js';

export async function listOrdersForCustomer(customerId: string): Promise<unknown[]> {
  const pool = getPool();
  return pool.query(`SELECT * FROM orders WHERE customer_id = '${customerId}' ORDER BY placed_at DESC`);
}
