/** Public, read-only GitHub status. A run from another commit can never make this pipeline green. */
export const REPOSITORY = 'blueprint-conformance/bce';
export const WORKFLOWS = [
  { id: 'gate', path: '.github/workflows/self-gate.yml', label: 'Self-gate + doctor' },
  { id: 'tests', path: '.github/workflows/ci.yml', label: 'Tests + evidence' },
  { id: 'portability', path: '.github/workflows/portability.yml', label: 'Node 22 / 24' },
  { id: 'pages', path: '.github/workflows/publish-schemas.yml', label: 'Pages deployment' },
];
const IN_PROGRESS = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const FAILURE = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const SHA = /^[a-f0-9]{40}$/;

export function summarizeRuns(head, payload) {
  if (!SHA.test(head) || !Array.isArray(payload?.workflow_runs) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
    throw new Error('GitHub returned an invalid workflow response');
  }
  // Do not grade an incomplete page of runs: a newer attempt may be outside it.
  if (payload.total_count > payload.workflow_runs.length) throw new Error('GitHub returned an incomplete workflow list');
  return WORKFLOWS.map(workflow => {
    const candidates = payload.workflow_runs.filter(run =>
      run.head_sha === head && run.head_branch === 'main' && run.event === 'push' &&
      run.repository?.full_name === REPOSITORY && run.path?.split('@')[0] === workflow.path);
    for (const run of candidates) {
      if (!Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_number) || run.run_number < 1 ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('GitHub returned an invalid run identity');
    }
    candidates.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt || b.id - a.id);
    const run = candidates[0];
    let state = 'unknown';
    let text = 'Awaiting run';
    if (run) {
      if (IN_PROGRESS.has(run.status)) { state = 'running'; text = 'In progress'; }
      else if (run.status === 'completed' && run.conclusion === 'success') { state = 'passed'; text = 'Passed'; }
      else if (run.status === 'completed' && FAILURE.has(run.conclusion)) { state = 'failed'; text = 'Failed'; }
      else { text = run.conclusion === 'cancelled' ? 'Cancelled' : run.conclusion === 'skipped' ? 'Skipped' : 'Not verified'; }
    }
    return { ...workflow, state, text, url: run
      ? `https://github.com/${REPOSITORY}/actions/runs/${run.id}`
      : `https://github.com/${REPOSITORY}/actions/workflows/${workflow.path.split('/').at(-1)}` };
  });
}

export async function readPipeline(fetcher = fetch, signal) {
  const options = { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  const get = async url => {
    const response = await fetcher(url, options);
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub rate limit or access restriction' : 'GitHub status request failed');
    return response.json();
  };
  const commit = await get(`https://api.github.com/repos/${REPOSITORY}/commits/main`);
  if (!SHA.test(commit?.sha)) throw new Error('GitHub returned an invalid main commit');
  const runs = await get(`https://api.github.com/repos/${REPOSITORY}/actions/runs?branch=main&event=push&head_sha=${commit.sha}&per_page=100`);
  return { head: commit.sha, stages: summarizeRuns(commit.sha, runs) };
}

export function mountPipeline(root) {
  const button = root.querySelector('[data-refresh]');
  const message = root.querySelector('[data-live-message]');
  const overall = root.querySelector('[data-overall]');
  const source = root.querySelector('[data-source]');
  let busy = false;
  let checked = 0;
  const interval = 5 * 60 * 1000;
  const setStage = (id, state, text, url) => {
    const row = root.querySelector(`[data-stage="${id}"]`);
    row.dataset.state = state;
    row.querySelector('[data-state]').textContent = text;
    if (url) row.querySelector('a').href = url;
  };
  const refresh = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Checking…';
    overall.textContent = 'Checking GitHub';
    overall.dataset.state = 'unknown';
    // Clear old success immediately, including links to old runs.
    source.textContent = 'main';
    source.href = `https://github.com/${REPOSITORY}/commits/main/`;
    setStage('source', 'unknown', 'Checking');
    for (const workflow of WORKFLOWS) setStage(workflow.id, 'unknown', 'Checking',
      `https://github.com/${REPOSITORY}/actions/workflows/${workflow.path.split('/').at(-1)}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const result = await readPipeline(fetch, controller.signal);
      checked = Date.now();
      source.textContent = `main @ ${result.head.slice(0, 7)}`;
      source.href = `https://github.com/${REPOSITORY}/commit/${result.head}`;
      setStage('source', 'observed', 'Observed commit');
      result.stages.forEach(stage => setStage(stage.id, stage.state, stage.text, stage.url));
      const state = result.stages.every(stage => stage.state === 'passed') ? 'passed'
        : result.stages.some(stage => stage.state === 'failed') ? 'failed'
          : result.stages.some(stage => stage.state === 'running') ? 'running' : 'unknown';
      overall.dataset.state = state;
      overall.textContent = { passed: '4 workflow stages passed', failed: 'Pipeline needs attention', running: 'Verification in progress', unknown: 'Verification incomplete' }[state];
      message.textContent = `Checked ${new Date(checked).toLocaleString()}. All stages refer to the observed main commit. Refreshes every 5 minutes while visible.`;
    } catch (error) {
      checked = Date.now();
      overall.textContent = 'Live status unavailable';
      overall.dataset.state = 'unknown';
      setStage('source', 'unknown', 'Unavailable');
      for (const workflow of WORKFLOWS) setStage(workflow.id, 'unknown', 'Unavailable');
      message.textContent = `Could not verify live status at ${new Date(checked).toLocaleTimeString()}. ${error?.name === 'AbortError' ? 'The request timed out.' : error.message + '.'} Use the GitHub links or try again later. Committed evidence below remains available.`;
    } finally {
      clearTimeout(timeout);
      busy = false;
      button.disabled = false;
      button.textContent = 'Refresh status';
    }
  };
  button.hidden = false;
  button.addEventListener('click', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, interval);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checked >= interval) refresh(); });
  refresh();
}

if (typeof document !== 'undefined') document.querySelectorAll('[data-self-adoption]').forEach(mountPipeline);
