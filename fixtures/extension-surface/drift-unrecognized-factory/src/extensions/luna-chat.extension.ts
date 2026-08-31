/**
 * ADVERSARIAL FIXTURE (verify finding #1): a file that imports a forbidden provider SDK directly
 * but whose factory is NOT name-recognized (`chat`, not `…Extension`, no default export). Before
 * the fix, the forbidden-import scan was gated behind factory recognition, so this scored 100/pass.
 * After the fix, the forbidden `imports` edge is emitted on a file-scoped pseudo-component and the
 * critical `no-direct-provider-sdk` (from:*) constraint fires → 60/fail.
 */
import OpenAI from 'openai'; // FORBIDDEN — must be caught even without a recognized factory

export const chat = (pi: unknown): void => {
  // not a `…Extension` name, no default export → not a recognized component, but the import
  // must STILL be caught.
  void pi;
  void OpenAI;
};
