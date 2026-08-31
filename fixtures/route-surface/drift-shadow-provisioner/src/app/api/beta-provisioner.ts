/**
 * SEEDED-DEFECT FIXTURE (rg-shadow-provisioner-file) — a parallel `*-provisioner.ts` written as
 * a NAMED-EXPORT CLASS, which extracts ZERO components (the exact evasion `forbiddenFile` was
 * built for — see the raw-file-teeth comment in report.ts). The catch fires via `coverage.scannedFiles`
 * (component `file:src/app/api/beta-provisioner.ts`), NOT via any extracted component — proving
 * the raw-file tooth specifically. d6 / forbiddenPath / forbiddenPattern all stay green here.
 */
export class BetaProvisioner {
  async provision(slug: string): Promise<{ slug: string; ok: boolean }> {
    // DRIFT: a parallel provisioning path beside the governed wizard — the file's
    // existence under the surface is the violation, regardless of export shape.
    return { slug, ok: true };
  }
}
