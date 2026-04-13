/**
 * System metrics aggregation — computes quality, cost, success rate,
 * and completion time from tasks, budget_log, and task_events.
 *
 * Powers the optimization engine and GET /api/v1/optimization/metrics.
 */

import { getDb } from './db.js';

export interface SystemMetrics {
  window: { from: number; to: number };
  tasks: {
    total: number;
    done: number;
    failed: number;
    canceled: number;
    avgCompletionMs: number;
  };
  quality: {
    avgScore: number;
    minScore: number;
    maxScore: number;
    belowThreshold: number;  // count of tasks with quality < 60
  };
  cost: {
    totalUsd: number;
    avgPerTask: number;
    byRole: Record<string, number>;
    byModel: Record<string, number>;
  };
  agents: {
    successRate: Record<string, number>;
    avgTime: Record<string, number>;
  };
}

/**
 * Compute aggregated system metrics over a rolling window.
 * @param windowDays — number of days to look back (default 7)
 */
export function computeSystemMetrics(windowDays = 7): SystemMetrics {
  const db = getDb();
  const now = Date.now();
  const from = now - windowDays * 24 * 60 * 60 * 1000;

  // --- Task counts ---
  const taskRows = db.prepare(`
    SELECT state, COUNT(*) as cnt
    FROM tasks
    WHERE created_at >= ?
    GROUP BY state
  `).all(from) as Array<{ state: string; cnt: number }>;

  const stateCounts: Record<string, number> = {};
  let total = 0;
  for (const r of taskRows) {
    stateCounts[r.state] = r.cnt;
    total += r.cnt;
  }

  const done = stateCounts['done'] ?? 0;
  const failed = stateCounts['failed'] ?? 0;
  const canceled = stateCounts['canceled'] ?? 0;

  // --- Average completion time (for done tasks with completed_at) ---
  const completionRow = db.prepare(`
    SELECT AVG(completed_at - created_at) as avg_ms
    FROM tasks
    WHERE state = 'done' AND completed_at IS NOT NULL AND created_at >= ?
  `).get(from) as { avg_ms: number | null } | undefined;
  const avgCompletionMs = completionRow?.avg_ms ?? 0;

  // --- Quality scores from task_events ---
  const qualityRows = db.prepare(`
    SELECT te.payload
    FROM task_events te
    JOIN tasks t ON te.task_id = t.id
    WHERE te.type = 'task:quality-score' AND t.created_at >= ?
  `).all(from) as Array<{ payload: string }>;

  let qualitySum = 0;
  let qualityMin = Infinity;
  let qualityMax = -Infinity;
  let belowThreshold = 0;
  let qualityCount = 0;

  for (const row of qualityRows) {
    try {
      const payload = JSON.parse(row.payload);
      const score = typeof payload.score === 'number' ? payload.score : null;
      if (score !== null) {
        qualitySum += score;
        if (score < qualityMin) qualityMin = score;
        if (score > qualityMax) qualityMax = score;
        if (score < 60) belowThreshold++;
        qualityCount++;
      }
    } catch { /* skip malformed */ }
  }

  const avgScore = qualityCount > 0 ? qualitySum / qualityCount : 0;

  // --- Cost ---
  const costTotal = db.prepare(`
    SELECT SUM(cost_usd) as total
    FROM budget_log
    WHERE created_at >= ?
  `).get(from) as { total: number | null } | undefined;
  const totalUsd = costTotal?.total ?? 0;

  const costByRole = db.prepare(`
    SELECT agent_role, SUM(cost_usd) as total
    FROM budget_log
    WHERE created_at >= ?
    GROUP BY agent_role
  `).all(from) as Array<{ agent_role: string; total: number }>;
  const byRole: Record<string, number> = {};
  for (const r of costByRole) byRole[r.agent_role] = r.total;

  // budget_log doesn't have model column — use empty for now
  const byModel: Record<string, number> = {};

  const avgPerTask = total > 0 ? totalUsd / total : 0;

  // --- Per-agent success rate and average time ---
  const agentStats = db.prepare(`
    SELECT assignee, state, COUNT(*) as cnt,
           AVG(CASE WHEN state = 'done' AND completed_at IS NOT NULL
               THEN completed_at - created_at ELSE NULL END) as avg_ms
    FROM tasks
    WHERE created_at >= ? AND assignee IS NOT NULL
    GROUP BY assignee, state
  `).all(from) as Array<{ assignee: string; state: string; cnt: number; avg_ms: number | null }>;

  const agentTotals: Record<string, number> = {};
  const agentDone: Record<string, number> = {};
  const agentAvgTime: Record<string, number> = {};

  for (const r of agentStats) {
    agentTotals[r.assignee] = (agentTotals[r.assignee] ?? 0) + r.cnt;
    if (r.state === 'done') {
      agentDone[r.assignee] = (agentDone[r.assignee] ?? 0) + r.cnt;
      if (r.avg_ms !== null) agentAvgTime[r.assignee] = r.avg_ms;
    }
  }

  const successRate: Record<string, number> = {};
  for (const [agent, total] of Object.entries(agentTotals)) {
    const d = agentDone[agent] ?? 0;
    successRate[agent] = total > 0 ? (d / total) * 100 : 0;
  }

  return {
    window: { from, to: now },
    tasks: { total, done, failed, canceled, avgCompletionMs },
    quality: {
      avgScore,
      minScore: qualityCount > 0 ? qualityMin : 0,
      maxScore: qualityCount > 0 ? qualityMax : 0,
      belowThreshold,
    },
    cost: { totalUsd, avgPerTask, byRole, byModel },
    agents: { successRate, avgTime: agentAvgTime },
  };
}
