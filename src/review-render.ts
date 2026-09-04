/** Deterministic, policy-free renderers over the canonical review packet. */
import { stableStringify } from './report.js';
import {
  BlueprintDecisionRecordSchema,
  BlueprintReviewPacketSchema,
  type BlueprintDecisionRecord,
  type BlueprintReviewPacket,
} from './review-contracts.js';
import { verifyReviewPacket } from './review.js';

const ANSI = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const BIDI_AND_INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const UNSAFE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g;

export function reviewSafeText(value: string): string {
  return value.replace(ANSI, '').replace(BIDI_AND_INVISIBLE, '').replace(UNSAFE_CONTROL, '');
}

function line(value: unknown): string {
  return reviewSafeText(String(value));
}

function bullet(values: readonly string[], empty = '(none)'): string[] {
  return values.length > 0 ? values.map((value) => `  - ${line(value)}`) : [`  - ${empty}`];
}

/** One terminal grammar for every clause: Promise, Lens, Proof, Limits. */
function verifiedInputs(
  input: BlueprintReviewPacket,
  decisionInput?: BlueprintDecisionRecord,
): { packet: BlueprintReviewPacket; decision?: BlueprintDecisionRecord } {
  const packet = BlueprintReviewPacketSchema.parse(input);
  const decision = decisionInput === undefined ? undefined : BlueprintDecisionRecordSchema.parse(decisionInput);
  const verification = verifyReviewPacket(packet, decision);
  if (!verification.valid) throw new Error(`refusing to render invalid review evidence: ${verification.failures.join('; ')}`);
  return { packet, ...(decision ? { decision } : {}) };
}

export function renderReviewPacketText(input: BlueprintReviewPacket, decisionInput?: BlueprintDecisionRecord): string {
  const { packet, decision } = verifiedInputs(input, decisionInput);
  const rows: string[] = [
    `BCE Blueprint Review — ${line(packet.proposalId)}`,
    `Packet: sha256:${packet.packetDigest}`,
    `Candidate: sha256:${packet.provenance.candidateDigest} (draft only)`,
    `Repository: ${line(packet.identity.repository.identity)} @ ${line(packet.identity.repository.revision)}`,
    `Engine: ${line(packet.identity.engine.name)}@${line(packet.identity.engine.version)} (${packet.identity.engine.artifactDigest})`,
    `Extractor: ${line(packet.identity.extractor.provider)}/${line(packet.identity.extractor.kind)}/${line(packet.identity.extractor.profile)}`,
    '',
    'Intent',
    ...bullet(packet.contract.intent),
    '',
    'Contract',
    `  ${line(packet.contract.plainLanguageContract)}`,
    '',
    'Scope — matched',
    ...bullet(packet.contract.resolvedScope.matchedFiles),
    'Scope — excluded',
    ...bullet(packet.contract.resolvedScope.excludedPaths),
    'Scope — exclusion classes',
    ...bullet(packet.contract.resolvedScope.excludedClasses),
    '',
    `Semantic change: ${packet.semanticDiff.classification}${packet.semanticDiff.blocksApproval ? ' (BLOCKS APPROVAL)' : ''}`,
    ...bullet(packet.semanticDiff.changes.map((change) => `${change.classification}: ${change.path} — ${change.summary}`)),
    '',
    `Current conformance: ${packet.conformance.verdict.toUpperCase()} / ${packet.conformance.score} / ${packet.conformance.violations.length} violation(s)`,
    `Teeth: ${packet.proof.verdict} — ${line(packet.proof.summary)}`,
    '',
    'Clauses',
  ];
  for (const clause of packet.contract.clauses) {
    rows.push(
      '',
      `[${line(clause.constraintId)}] ${line(clause.type)} / ${line(clause.severity)}`,
      `  Promise: ${line(clause.promise)}`,
      `  Lens: ${line(clause.lens.summary)}`,
      `    Matched: ${clause.lens.matchedScope.length > 0 ? clause.lens.matchedScope.map(line).join(', ') : '(none)'}`,
      `  Proof: ${line(clause.proof.gradeability)} / ${line(clause.proof.teeth)} — ${line(clause.proof.summary)}`,
      '  Limits:',
      ...bullet(clause.limits, '(none)').map((value) => `  ${value}`),
      '  Canonical JSON:',
      ...reviewSafeText(clause.canonicalJson).trimEnd().split('\n').map((value) => `    ${value}`),
    );
  }
  rows.push(
    '',
    `Approval: ${packet.approval.status.toUpperCase()}`,
    ...bullet(packet.approval.blockers),
    'Approval requirements',
    ...bullet(packet.approval.requirements.map((requirement) => `${requirement.role} / ${requirement.stage}`)),
    '',
    'Human decision',
    ...(decision ? [
      `  ${decision.decision.toUpperCase()} by ${line(decision.reviewer.id)} at ${line(decision.decidedAt)}`,
      `  Decision: sha256:${decision.decisionDigest}`,
      `  Authentication: ${line(decision.reviewer.authentication.method)} / ${line(decision.reviewer.authentication.subject)}`,
      `  Weakening accepted: ${decision.weakeningAccepted ? 'yes' : 'no'}`,
      `  Reference: ${line(decision.reviewer.authentication.reference)}`,
      `  Rationale: ${line(decision.rationale)}`,
    ] : ['  (no DecisionRecord supplied; freshness and human authority remain unproven)']),
    '',
    'Unsupported coverage',
    ...bullet(packet.unsupportedCoverage),
    '',
    'Provenance',
    `  Context: ${packet.provenance.contextDigest}`,
    `  Plan: ${packet.provenance.planDigest}`,
    `  Generation: ${packet.provenance.generationDigest}`,
    `  Graph: ${packet.provenance.graphDigest}`,
    `  Report: ${packet.provenance.reportDigest}`,
    `  Teeth: ${packet.provenance.teethDigest}`,
    '',
  );
  return rows.join('\n');
}

function escapeHtml(value: string): string {
  return reviewSafeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlList(values: readonly string[]): string {
  return values.length > 0
    ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    : '<p class="empty">None reported.</p>';
}

export function renderReviewPacketHtml(input: BlueprintReviewPacket, decisionInput?: BlueprintDecisionRecord): string {
  const { packet, decision } = verifiedInputs(input, decisionInput);
  const clauses = packet.contract.clauses.map((clause) => `
    <article class="clause">
      <h3>${escapeHtml(clause.constraintId)}</h3>
      <p class="meta">${escapeHtml(clause.type)} · ${escapeHtml(clause.severity)}</p>
      <dl>
        <dt>Promise</dt><dd>${escapeHtml(clause.promise)}</dd>
        <dt>Lens</dt><dd>${escapeHtml(clause.lens.summary)}${htmlList(clause.lens.matchedScope)}</dd>
        <dt>Proof</dt><dd>${escapeHtml(`${clause.proof.gradeability} / ${clause.proof.teeth} — ${clause.proof.summary}`)}</dd>
        <dt>Limits</dt><dd>${htmlList(clause.limits)}</dd>
      </dl>
      <details><summary>Canonical JSON</summary><pre>${escapeHtml(clause.canonicalJson)}</pre></details>
    </article>`).join('');
  const canonical = stableStringify(packet);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BCE Blueprint Review — ${escapeHtml(packet.proposalId)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#17202a}code,pre{font-family:ui-monospace,monospace}.status{padding:.75rem;border:2px solid currentColor}.blocked{color:#8b1a10}.clause{border-top:1px solid #ccd1d1;padding:1rem 0}dt{font-weight:700;margin-top:.75rem}dd{margin-left:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7f8;padding:1rem}.meta,.empty{color:#566573}</style></head>
<body><main>
  <h1>BCE Blueprint Review</h1>
  <p><strong>${escapeHtml(packet.proposalId)}</strong> · draft only</p>
  <p>Packet <code>sha256:${packet.packetDigest}</code><br>Candidate <code>sha256:${packet.provenance.candidateDigest}</code><br>Repository ${escapeHtml(packet.identity.repository.identity)} @ <code>${escapeHtml(packet.identity.repository.revision)}</code><br>Engine ${escapeHtml(`${packet.identity.engine.name}@${packet.identity.engine.version}`)} · <code>${packet.identity.engine.artifactDigest}</code></p>
  <section><h2>Intent</h2>${htmlList(packet.contract.intent)}<p>${escapeHtml(packet.contract.plainLanguageContract)}</p></section>
  <section><h2>Scope</h2><h3>Matched</h3>${htmlList(packet.contract.resolvedScope.matchedFiles)}<h3>Excluded</h3>${htmlList(packet.contract.resolvedScope.excludedPaths)}<h3>Exclusion classes</h3>${htmlList(packet.contract.resolvedScope.excludedClasses)}</section>
  <section><h2>Semantic change</h2><p>${escapeHtml(packet.semanticDiff.classification)}</p>${htmlList(packet.semanticDiff.changes.map((change) => `${change.classification}: ${change.path} — ${change.summary}`))}</section>
  <section><h2>Current conformance and proof</h2><p>${escapeHtml(`${packet.conformance.verdict.toUpperCase()} / ${packet.conformance.score} / ${packet.conformance.violations.length} violation(s)`)}</p><p>${escapeHtml(`${packet.proof.verdict} — ${packet.proof.summary}`)}</p></section>
  <section><h2>Clauses</h2>${clauses}</section>
  <section class="status ${packet.approval.status}"><h2>Approval: ${escapeHtml(packet.approval.status.toUpperCase())}</h2>${htmlList(packet.approval.blockers)}<h3>Requirements</h3>${htmlList(packet.approval.requirements.map((requirement) => `${requirement.role} / ${requirement.stage}`))}<p>Eligibility is not approval. Live freshness and SCM authority must be rechecked at decision and landing time.</p></section>
  <section><h2>Human decision</h2>${decision ? `<p><strong>${escapeHtml(decision.decision.toUpperCase())}</strong> by ${escapeHtml(decision.reviewer.id)} at ${escapeHtml(decision.decidedAt)}</p><p>Decision <code>sha256:${decision.decisionDigest}</code><br>Authentication ${escapeHtml(`${decision.reviewer.authentication.method} / ${decision.reviewer.authentication.subject}`)}<br>Weakening accepted: ${decision.weakeningAccepted ? 'yes' : 'no'}<br><a href="${escapeHtml(decision.reviewer.authentication.reference)}">SCM evidence</a></p><p>${escapeHtml(decision.rationale)}</p>` : '<p>No DecisionRecord supplied; freshness and human authority remain unproven.</p>'}</section>
  <section><h2>Unsupported coverage</h2>${htmlList(packet.unsupportedCoverage)}</section>
  <details><summary>Canonical ReviewPacket JSON</summary><pre>${escapeHtml(canonical)}</pre></details>
</main></body></html>
`;
}
