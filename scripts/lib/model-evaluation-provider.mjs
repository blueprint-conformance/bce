import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonical(value));
const sha256Json = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export const OLLAMA_IDENTITY_SEMANTICS_V2 = 'ollama-tags-artifact-plus-active-name-digest-v2';

export function expectedLocalProviderIdentity(provider) {
  return {
    serverVersion: provider.serverVersion,
    modelName: provider.modelName,
    modelDigest: provider.modelDigest,
    modelSizeBytes: provider.modelSizeBytes,
  };
}

function activeIdentityMatches(activeModel, provider, semantics) {
  if (!activeModel) return false;
  if (semantics === OLLAMA_IDENTITY_SEMANTICS_V2) {
    const optionalRuntimeBytes = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
    return activeModel.modelName === provider.modelName &&
      activeModel.modelDigest === provider.modelDigest &&
      optionalRuntimeBytes(activeModel.runtimeSizeBytes) &&
      optionalRuntimeBytes(activeModel.runtimeVramBytes) &&
      optionalRuntimeBytes(activeModel.contextLength);
  }
  return canonicalJson(activeModel) === canonicalJson({
    modelName: provider.modelName,
    modelDigest: provider.modelDigest,
    modelSizeBytes: provider.modelSizeBytes,
  });
}

export function localProviderProofMatches(proof, provider, { requireActiveModel = false } = {}) {
  if (!proof || !provider) return false;
  const expected = expectedLocalProviderIdentity(provider);
  return proof.matched === true &&
    proof.endpoint === provider.endpoint &&
    proof.activeModelRequired === requireActiveModel &&
    canonicalJson(proof.response) === canonicalJson(expected) &&
    proof.responseSha256 === sha256Json(expected) &&
    (!requireActiveModel || (
      activeIdentityMatches(proof.activeModel, provider, proof.identitySemantics) &&
      proof.activeModelSha256 === sha256Json(proof.activeModel)
    ));
}

export function localProviderProofWellFormed(proof, provider) {
  if (!proof || proof.endpoint !== provider.endpoint) return false;
  const hasProcessOutcome = Number.isInteger(proof.exitCode) ||
    (proof.exitCode === null && typeof proof.signal === 'string' && proof.signal.length > 0);
  if (!hasProcessOutcome || typeof proof.activeModelRequired !== 'boolean' ||
      (proof.identitySemantics !== undefined && proof.identitySemantics !== OLLAMA_IDENTITY_SEMANTICS_V2)) {
    return false;
  }
  if (proof.response === null) {
    return proof.responseSha256 === null && proof.matched === false &&
      proof.activeModel === null && proof.activeModelSha256 === null;
  }
  if (!proof.response || typeof proof.response !== 'object' || proof.responseSha256 !== sha256Json(proof.response) || typeof proof.matched !== 'boolean') {
    return false;
  }
  return (proof.activeModel === null && proof.activeModelSha256 === null) ||
    (proof.activeModel && proof.activeModelSha256 === sha256Json(proof.activeModel));
}

export function localProviderIdentityStable(before, after, provider) {
  return localProviderProofMatches(before, provider) &&
    localProviderProofMatches(after, provider, { requireActiveModel: true }) &&
    before.responseSha256 === after.responseSha256;
}
