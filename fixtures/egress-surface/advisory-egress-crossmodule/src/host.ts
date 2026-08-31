/**
 * FIXTURE helper — coverage-envelope Class B #4: the imported host const.
 *
 * The literal lives HERE, in a DIFFERENT module from the reader that fetches it. The resolver's
 * same-file const-hop stops at the module boundary (it never follows a cross-module import — that
 * would require full symbol resolution, which the resolver deliberately does not do), so from the
 * reader's perspective `PROVIDER_BASE` is unresolvable.
 */
export const PROVIDER_BASE = 'https://api.openai.com';
