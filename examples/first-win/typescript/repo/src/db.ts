/**
 * The data-access seam. Every query goes through this pool, and every query is
 * parameterized — the driver escapes the values, the caller never does.
 */
export interface Pool {
  query(sql: string, params?: readonly unknown[]): Promise<unknown[]>;
}

export function getPool(): Pool {
  return {
    async query(_sql: string, _params?: readonly unknown[]) {
      return [];
    },
  };
}
