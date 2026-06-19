import { mkdir, writeFile } from 'node:fs/promises';

const REPORT_DIR = 'reports';
const MARKDOWN_PATH = `${REPORT_DIR}/backend-metrics.md`;
const JSON_PATH = `${REPORT_DIR}/backend-metrics.json`;
const DAY_MS = 24 * 60 * 60 * 1000;

const env = process.env;
const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
const apiBase = env.GITHUB_API_URL || 'https://api.github.com';
const token = env.GITHUB_TOKEN || '';
const runId = env.GITHUB_RUN_ID || '';
const now = new Date();
const warnings = [];

function msBetween(start, end) {
  const from = start ? new Date(start).getTime() : NaN;
  const to = end ? new Date(end).getTime() : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return to - from;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'N/A';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function average(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percent(value) {
  if (value === null || value === undefined) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function isoDaysAgo(days) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function isRecent(date, days) {
  if (!date) return false;
  return new Date(date).getTime() >= now.getTime() - days * DAY_MS;
}

async function github(path) {
  if (!token || !owner || !repo) {
    throw new Error('GitHub API unavailable: missing GITHUB_TOKEN or GITHUB_REPOSITORY');
  }

  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function safe(label, fallback, loader) {
  try {
    return await loader();
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

async function getCurrentRun() {
  if (!runId) return null;
  return safe('current run', null, () => github(`/repos/${owner}/${repo}/actions/runs/${runId}`));
}

async function getRuns() {
  return safe('workflow runs', [], async () => {
    const response = await github(
      `/repos/${owner}/${repo}/actions/runs?branch=main&per_page=50&exclude_pull_requests=false`,
    );
    return response.workflow_runs || [];
  });
}

async function getMergedPulls() {
  return safe('merged pull requests', [], async () => {
    const response = await github(
      `/repos/${owner}/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`,
    );
    return (response || []).filter((pull) => Boolean(pull.merged_at));
  });
}

async function getFailedJobsForRuns(runs) {
  const failedRuns = runs
    .filter((run) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion))
    .slice(0, 10);
  const causes = new Map();

  for (const run of failedRuns) {
    const jobsResponse = await safe(`jobs for run ${run.id}`, { jobs: [] }, () =>
      github(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`),
    );

    for (const job of jobsResponse.jobs || []) {
      if (!['failure', 'cancelled', 'timed_out', 'action_required'].includes(job.conclusion)) continue;

      const failedSteps = (job.steps || []).filter((step) =>
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion),
      );

      if (failedSteps.length === 0) {
        causes.set(job.name, (causes.get(job.name) || 0) + 1);
        continue;
      }

      for (const step of failedSteps) {
        const name = `${job.name} / ${step.name}`;
        causes.set(name, (causes.get(name) || 0) + 1);
      }
    }
  }

  return [...causes.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function calculateRecoveryTimes(runs) {
  const completedRuns = runs
    .filter((run) => run.created_at && run.conclusion)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const recoveryTimes = [];

  for (let i = 0; i < completedRuns.length; i += 1) {
    const failedRun = completedRuns[i];
    if (!['failure', 'cancelled', 'timed_out', 'action_required'].includes(failedRun.conclusion)) continue;

    const nextSuccess = completedRuns
      .slice(i + 1)
      .find((run) => run.conclusion === 'success' && new Date(run.created_at) > new Date(failedRun.created_at));

    const recoveryMs = msBetween(failedRun.updated_at || failedRun.created_at, nextSuccess?.updated_at);
    if (recoveryMs !== null) recoveryTimes.push(recoveryMs);
  }

  return recoveryTimes;
}

function buildMarkdown(metrics) {
  const causes = metrics.topBlockingCauses.length
    ? metrics.topBlockingCauses.map((cause) => `| ${cause.name} | ${cause.count} |`).join('\n')
    : '| N/A | 0 |';

  const warningBlock = metrics.warnings.length
    ? `\n## Observaciones\n\n${metrics.warnings.map((warning) => `- ${warning}`).join('\n')}\n`
    : '';

  return `# Backend measurable parameters

| Parámetro | Valor | Estado |
|---|---:|---|
| Tiempo de integración del run actual | ${formatDuration(metrics.integrationTimeMs)} | ${metrics.integrationTimeMs === null ? 'Parcial' : 'Implementado'} |
| Frecuencia de integraciones exitosas en 7 días | ${metrics.integrationFrequency7d} | Implementado |
| Frecuencia de integraciones exitosas en 30 días | ${metrics.integrationFrequency30d} | Implementado |
| Tiempo promedio PR hasta merge | ${formatDuration(metrics.averagePrToMergeMs)} | ${metrics.averagePrToMergeMs === null ? 'Parcial' : 'Implementado'} |
| Promedio de fallas después de cambios en 30 días | ${percent(metrics.failureRate30d)} | Implementado |
| Tiempo promedio de recuperación | ${formatDuration(metrics.averageRecoveryMs)} | ${metrics.averageRecoveryMs === null ? 'Parcial' : 'Implementado'} |
| Causa principal de bloqueo | ${metrics.topBlockingCauses[0]?.name || 'N/A'} | ${metrics.topBlockingCauses.length ? 'Implementado' : 'Parcial'} |

## Checklist

- [x] tiempo de integración
- [x] frecuencia de integraciones
- [x] tiempo desde PR hasta merge
- [x] promedio de fallas después de cambios
- [x] tiempo de recuperación
- [x] identificación de causas principales de bloqueo

## Causas principales de bloqueo

| Job / step | Ocurrencias |
|---|---:|
${causes}

## Contexto

| Campo | Valor |
|---|---|
| Workflow | ${metrics.workflow} |
| Evento | ${metrics.eventName} |
| Ref | ${metrics.ref} |
| Commit | ${metrics.sha} |
| Run ID | ${metrics.runId} |
| Ventana de runs | Desde ${isoDaysAgo(30)} |
${warningBlock}`;
}

async function main() {
  const currentRun = await getCurrentRun();
  const runs = await getRuns();
  const mergedPulls = await getMergedPulls();
  const topBlockingCauses = await getFailedJobsForRuns(runs);

  const integrationTimeMs = currentRun
    ? msBetween(currentRun.run_started_at || currentRun.created_at, currentRun.updated_at || now.toISOString())
    : null;

  const recent7 = runs.filter((run) => isRecent(run.created_at, 7));
  const recent30 = runs.filter((run) => isRecent(run.created_at, 30));
  const successful7 = recent7.filter((run) => run.conclusion === 'success');
  const successful30 = recent30.filter((run) => run.conclusion === 'success');
  const failed30 = recent30.filter((run) =>
    ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion),
  );

  const prToMergeTimes = mergedPulls.map((pull) => msBetween(pull.created_at, pull.merged_at));
  const recoveryTimes = calculateRecoveryTimes(runs);
  const failureRate30d = recent30.length ? failed30.length / recent30.length : 0;

  const metrics = {
    generatedAt: now.toISOString(),
    runId: runId || 'local',
    workflow: env.GITHUB_WORKFLOW || 'local',
    eventName: env.GITHUB_EVENT_NAME || 'local',
    ref: env.GITHUB_REF || 'local',
    sha: env.GITHUB_SHA || 'local',
    repository: env.GITHUB_REPOSITORY || 'local',
    integrationTimeMs,
    integrationFrequency7d: successful7.length,
    integrationFrequency30d: successful30.length,
    averagePrToMergeMs: average(prToMergeTimes),
    failureRate30d,
    averageRecoveryMs: average(recoveryTimes),
    topBlockingCauses,
    sampleSize: {
      runs: runs.length,
      recentRuns7d: recent7.length,
      recentRuns30d: recent30.length,
      mergedPullRequests: mergedPulls.length,
      recoveryPairs: recoveryTimes.length,
    },
    warnings,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(JSON_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(MARKDOWN_PATH, buildMarkdown(metrics));

  console.log(`Backend metrics written to ${MARKDOWN_PATH} and ${JSON_PATH}`);
}

await main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const fallback = {
    generatedAt: now.toISOString(),
    runId: runId || 'local',
    workflow: env.GITHUB_WORKFLOW || 'local',
    eventName: env.GITHUB_EVENT_NAME || 'local',
    ref: env.GITHUB_REF || 'local',
    sha: env.GITHUB_SHA || 'local',
    repository: env.GITHUB_REPOSITORY || 'local',
    integrationTimeMs: null,
    integrationFrequency7d: 0,
    integrationFrequency30d: 0,
    averagePrToMergeMs: null,
    failureRate30d: 0,
    averageRecoveryMs: null,
    topBlockingCauses: [],
    sampleSize: {
      runs: 0,
      recentRuns7d: 0,
      recentRuns30d: 0,
      mergedPullRequests: 0,
      recoveryPairs: 0,
    },
    warnings: [...warnings, `fatal fallback: ${message}`],
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(JSON_PATH, `${JSON.stringify(fallback, null, 2)}\n`);
  await writeFile(MARKDOWN_PATH, buildMarkdown(fallback));
  console.log(`Backend metrics fallback written after error: ${message}`);
});
