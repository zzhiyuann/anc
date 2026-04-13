#!/usr/bin/env npx tsx
/**
 * GitHub Per-Contributor Issue Streams
 *
 * Fetches longitudinal issue streams from GitHub repos:
 * - For each active contributor, extract their sequence of issues/PRs
 * - Creates realistic task sequences that test memory accumulation
 * - Outputs TaskSpec[] format for SimCEO evaluation
 *
 * Uses `gh` CLI (no API key management needed).
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  created_at: string;
  closed_at: string | null;
  author: string;
  assignees: string[];
  comments: number;
  pull_request: boolean;
}

interface ContributorStream {
  contributor: string;
  repo: string;
  issues: GitHubIssue[];
  total_issues: number;
}

interface TaskSpec {
  id: string;
  title: string;
  description: string;
  repo: string;
  expected_labels: string[];
  complexity: 'low' | 'medium' | 'high';
  source: 'github' | 'swebench' | 'custom';
  ground_truth?: string;
}

// --- Target repos ---
// Selected for: active development, good issue hygiene, diverse task types

const TARGET_REPOS = [
  'astral-sh/ruff',           // Python linter — bugs + features, well-labeled
  'pydantic/pydantic',        // Data validation — clear issues, good tests
  'fastapi/fastapi',          // Web framework — diverse issue types
  'langchain-ai/langchain',   // LLM framework — complex multi-file changes
  'vercel/next.js',           // React framework — large codebase, many contributors
];

// --- GitHub CLI wrapper ---

function ghApi(endpoint: string, params: Record<string, string> = {}): any {
  const paramStr = Object.entries(params)
    .map(([k, v]) => `--${k.includes('-') ? k : `field ${k}`}=${v}`)
    .join(' ');

  try {
    const cmd = `gh api "${endpoint}" ${paramStr} --paginate 2>/dev/null`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30_000 });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

function fetchRepoIssues(repo: string, limit = 500): GitHubIssue[] {
  console.log(`  Fetching issues from ${repo}...`);

  try {
    const result = execSync(
      `gh issue list --repo ${repo} --state all --limit ${limit} --json number,title,labels,state,createdAt,closedAt,author,assignees,comments`,
      { encoding: 'utf-8', timeout: 60_000, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, GH_TOKEN: '' } }
    );

    const issues = JSON.parse(result);
    return issues.map((i: any) => ({
      number: i.number,
      title: i.title,
      body: '', // fetched separately for selected issues to avoid buffer overflow
      labels: (i.labels || []).map((l: any) => l.name),
      state: i.state,
      created_at: i.createdAt,
      closed_at: i.closedAt,
      author: i.author?.login || 'unknown',
      assignees: (i.assignees || []).map((a: any) => a.login),
      comments: i.comments || 0,
      pull_request: false,
    }));
  } catch (e: any) {
    console.error(`  Failed to fetch ${repo}: ${e.message}`);
    return [];
  }
}

// --- Stream extraction ---

function extractContributorStreams(
  repo: string,
  issues: GitHubIssue[],
  minIssues = 5,
  maxIssues = 50
): ContributorStream[] {
  // Group by assignee (primary contributor who worked on it)
  const byContributor = new Map<string, GitHubIssue[]>();

  for (const issue of issues) {
    const assignee = issue.assignees[0] || issue.author;
    if (!assignee || assignee === 'unknown') continue;

    const list = byContributor.get(assignee) || [];
    list.push(issue);
    byContributor.set(assignee, list);
  }

  // Filter to contributors with enough issues, sort chronologically
  const streams: ContributorStream[] = [];

  for (const [contributor, contribIssues] of byContributor) {
    if (contribIssues.length < minIssues) continue;

    const sorted = contribIssues
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, maxIssues);

    streams.push({
      contributor,
      repo,
      issues: sorted,
      total_issues: sorted.length,
    });
  }

  // Sort by stream length (longer = more useful for memory evaluation)
  return streams.sort((a, b) => b.total_issues - a.total_issues);
}

// --- Convert to TaskSpec ---

function issueToTaskSpec(issue: GitHubIssue, repo: string, streamIndex: number): TaskSpec {
  const complexity = inferComplexity(issue);

  return {
    id: `gh_${repo.replace('/', '_')}_${issue.number}`,
    title: issue.title,
    description: `Repository: ${repo}\nIssue #${issue.number}\n\n${issue.body}`,
    repo,
    expected_labels: issue.labels.slice(0, 5),
    complexity,
    source: 'github',
    ground_truth: undefined, // Could link to the actual PR that closed it
  };
}

function inferComplexity(issue: GitHubIssue): 'low' | 'medium' | 'high' {
  const labels = issue.labels.map((l) => l.toLowerCase());
  const body = (issue.body || '').toLowerCase();

  // High complexity indicators
  if (
    labels.some((l) => l.includes('breaking') || l.includes('major') || l.includes('rfc')) ||
    body.length > 1500 ||
    issue.comments > 10
  ) {
    return 'high';
  }

  // Low complexity indicators
  if (
    labels.some((l) => l.includes('typo') || l.includes('docs') || l.includes('good first')) ||
    body.length < 200
  ) {
    return 'low';
  }

  return 'medium';
}

// --- Main pipeline ---

async function buildDataset(outputDir: string) {
  mkdirSync(outputDir, { recursive: true });

  const allStreams: ContributorStream[] = [];
  const allTasks: TaskSpec[] = [];

  for (const repo of TARGET_REPOS) {
    console.log(`\nProcessing ${repo}...`);

    // 1. Fetch issues
    const issues = fetchRepoIssues(repo, 300);
    console.log(`  Found ${issues.length} issues`);

    // 2. Extract contributor streams
    const streams = extractContributorStreams(repo, issues, 5, 30);
    console.log(`  Found ${streams.length} contributor streams (≥5 issues each)`);

    for (const stream of streams.slice(0, 3)) { // top 3 contributors per repo
      console.log(`    ${stream.contributor}: ${stream.total_issues} issues`);

      // Fetch body for each issue in selected streams
      for (const issue of stream.issues) {
        try {
          const bodyResult = execSync(
            `gh issue view ${issue.number} --repo ${repo} --json body --jq .body`,
            { encoding: 'utf-8', timeout: 10_000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, GH_TOKEN: '' } }
          );
          issue.body = (bodyResult || '').trim().slice(0, 2000);
        } catch {
          issue.body = '';
        }
      }

      allStreams.push(stream);

      // Convert to task specs
      const tasks = stream.issues.map((issue, idx) =>
        issueToTaskSpec(issue, repo, idx)
      );
      allTasks.push(...tasks);
    }
  }

  // Save outputs
  writeFileSync(
    join(outputDir, 'streams.json'),
    JSON.stringify(allStreams, null, 2)
  );

  writeFileSync(
    join(outputDir, 'tasks.json'),
    JSON.stringify(allTasks, null, 2)
  );

  // Save summary
  const summary = {
    repos: TARGET_REPOS.length,
    streams: allStreams.length,
    total_tasks: allTasks.length,
    tasks_by_complexity: {
      low: allTasks.filter((t) => t.complexity === 'low').length,
      medium: allTasks.filter((t) => t.complexity === 'medium').length,
      high: allTasks.filter((t) => t.complexity === 'high').length,
    },
    tasks_by_repo: Object.fromEntries(
      TARGET_REPOS.map((r) => [r, allTasks.filter((t) => t.repo === r).length])
    ),
    generated_at: new Date().toISOString(),
  };

  writeFileSync(
    join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(`\n[Done] ${allStreams.length} streams, ${allTasks.length} tasks`);
  console.log(`  Output: ${outputDir}`);
  console.log(`  Complexity: ${summary.tasks_by_complexity.low} low / ${summary.tasks_by_complexity.medium} medium / ${summary.tasks_by_complexity.high} high`);
}

// --- CLI ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2] || join(__dirname, '..', 'data', 'github');
  buildDataset(outputDir);
}
