/** Presentation of committed lifecycle records; the live doctor remains the readiness authority. */
import fs from 'node:fs';
import path from 'node:path';
import { WORKFLOWS, REPOSITORY } from '../../assets/site/self-adoption-status.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function selfAdoptionHtml(repoRoot, guideHref) {
  const adoption = JSON.parse(fs.readFileSync(path.join(repoRoot, '.bce-adoption.json'), 'utf8'));
  const history = fs.readFileSync(path.join(repoRoot, '.blueprints/POLICY-HISTORY.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const latest = history.filter(entry => entry.blueprintId === adoption.blueprintRef?.split('@')[0]).at(-1);
  if (adoption.ratified !== true || adoption.state !== 'ratified-enforced' || adoption.mode !== 'enforced' ||
      !['self-ratified', 'non-author-reviewed'].includes(adoption.reviewMode) ||
      latest?.toRef !== adoption.blueprintRef || latest.reviewerType !== 'scm-authenticated' ||
      (latest.reviewerAuthentication?.reviewMode ?? 'non-author-reviewed') !== adoption.reviewMode ||
      !/^https:\/\/github\.com\/blueprint-conformance\/bce\/pull\/\d+#pullrequestreview-\d+$/.test(latest.reviewerAuthentication?.reference ?? '')) {
    throw new Error('self-adoption site record has missing or contradictory authenticated lifecycle fields');
  }
  const stages = WORKFLOWS.map(workflow => `<li data-stage="${workflow.id}" data-state="unknown"><a href="https://github.com/${REPOSITORY}/actions/workflows/${workflow.path.split('/').at(-1)}">${workflow.label}</a><span data-state>Not checked</span></li>`).join('');
  return `<section class="self-adoption" data-self-adoption aria-labelledby="self-adoption-status">
<div class="self-adoption-heading"><h2 id="self-adoption-status">We use BCE to govern BCE.</h2><span class="pipeline-overall" data-overall data-state="unknown">Live checks not loaded</span></div>
<p>Follow the observed <code>main</code> commit through our own gate, evidence checks and public deployment. Every stage links to GitHub.</p>
<ol class="self-adoption-pipeline" aria-label="GitHub verification pipeline"><li data-stage="source" data-state="unknown"><a data-source href="https://github.com/${REPOSITORY}/commits/main/">Source: main</a><span data-state>Not checked</span></li>${stages}</ol>
<div class="self-adoption-refresh"><p data-live-message role="status">Live results require JavaScript and access to the public GitHub API.</p><button type="button" data-refresh hidden>Refresh status</button></div>
<p class="self-adoption-record">Committed policy: <code>${escape(adoption.blueprintRef)}</code>, <strong>${escape(adoption.state)}</strong>, <strong>${escape(adoption.reviewMode)}</strong>. <a href="${escape(latest.reviewerAuthentication.reference)}">Authenticated decision</a> · <a href="${escape(guideHref)}">How to read this pipeline</a>.</p>
<p class="self-adoption-limit">First-party operational evidence; no independent replication or product efficacy claim. These lifecycle additions are in source main; the immutable npm 0.3.0 artifact is unchanged.</p>
</section>`;
}
