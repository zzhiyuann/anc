/**
 * HANDOFF.md Actions parser.
 * Extracts structured action declarations from agent HANDOFF output.
 * Simple line-based parser — not full YAML (agents don't need to produce perfect YAML).
 */

import type { IssueStatus } from '../linear/types.js';
import { isKnownRole } from '../agents/registry.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('actions');

export interface DispatchAction {
  role: string;
  context: string;
  newIssue?: string;   // title for new sub-issue (omit = dispatch on same issue)
  priority?: number;
}

export interface HandoffActions {
  status: IssueStatus;
  dispatches: DispatchAction[];
  delegate?: string;
  parentStatus?: IssueStatus;
}

const VALID_STATUSES = new Set(['Done', 'In Review', 'In Progress', 'Todo', 'Backlog', 'Canceled']);

/**
 * Parse the ## Actions block from HANDOFF.md content.
 * Returns null if no Actions section found (backward compat).
 */
export function parseActions(handoff: string): HandoffActions | null {
  // Find ## Actions section
  const actionsMatch = handoff.match(/^## Actions\s*$/m);
  if (!actionsMatch || actionsMatch.index === undefined) return null;

  // Extract content from ## Actions to the next ## header or end of file
  const actionsStart = actionsMatch.index + actionsMatch[0].length;
  const nextSection = handoff.slice(actionsStart).match(/^## /m);
  const actionsContent = nextSection?.index !== undefined
    ? handoff.slice(actionsStart, actionsStart + nextSection.index).trim()
    : handoff.slice(actionsStart).trim();

  if (actionsContent.length === 0) return null;

  // Parse line by line
  const lines = actionsContent.split('\n');
  let status: IssueStatus = 'In Review';  // default
  const dispatches: DispatchAction[] = [];
  let delegate: string | undefined;
  let parentStatus: IssueStatus | undefined;

  let currentDispatch: Partial<DispatchAction> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('```')) continue;

    // Top-level key: value
    if (line.match(/^status:\s*/i)) {
      const val = line.replace(/^status:\s*/i, '').trim().replace(/["`']/g, '');
      if (VALID_STATUSES.has(val)) status = val as IssueStatus;
    } else if (line.match(/^delegate:\s*/i)) {
      const val = line.replace(/^delegate:\s*/i, '').trim().replace(/["`']/g, '');
      if (val && val !== 'null' && val !== 'none') delegate = val.toLowerCase();
    } else if (line.match(/^parent_status:\s*/i)) {
      const val = line.replace(/^parent_status:\s*/i, '').trim().replace(/["`']/g, '');
      if (VALID_STATUSES.has(val)) parentStatus = val as IssueStatus;
    } else if (line.match(/^dispatches:\s*$/i)) {
      // Start of dispatches list — handled by list items below
    } else if (line.match(/^-\s*role:\s*/i)) {
      // New dispatch entry
      if (currentDispatch?.role) {
        dispatches.push(finalizeDispatch(currentDispatch));
      }
      currentDispatch = { role: line.replace(/^-\s*role:\s*/i, '').trim().replace(/["`']/g, '').toLowerCase() };
    } else if (currentDispatch && line.match(/^context:\s*/i)) {
      currentDispatch.context = line.replace(/^context:\s*/i, '').trim().replace(/^["']|["']$/g, '');
    } else if (currentDispatch && line.match(/^new_issue:\s*/i)) {
      currentDispatch.newIssue = line.replace(/^new_issue:\s*/i, '').trim().replace(/^["']|["']$/g, '');
    } else if (currentDispatch && line.match(/^priority:\s*/i)) {
      currentDispatch.priority = parseInt(line.replace(/^priority:\s*/i, '').trim(), 10) || undefined;
    }
  }

  // Finalize last dispatch
  if (currentDispatch?.role) {
    dispatches.push(finalizeDispatch(currentDispatch));
  }

  // Validate
  const validDispatches = dispatches.filter(d => {
    if (!isKnownRole(d.role)) {
      log.warn(`Unknown role in dispatch: ${d.role}`);
      return false;
    }
    return true;
  });

  if (delegate && !isKnownRole(delegate)) {
    log.warn(`Unknown delegate role: ${delegate}`);
    delegate = undefined;
  }

  return { status, dispatches: validDispatches, delegate, parentStatus };
}

function finalizeDispatch(partial: Partial<DispatchAction>): DispatchAction {
  return {
    role: partial.role || 'ops',
    context: partial.context || '',
    newIssue: partial.newIssue,
    priority: partial.priority,
  };
}

/**
 * Extract the summary (everything before ## Actions) for posting as comment.
 */
export function extractSummary(handoff: string): string {
  const actionsIdx = handoff.search(/^## Actions\s*$/m);
  if (actionsIdx === -1) return handoff;  // no Actions block — entire content is summary
  return handoff.slice(0, actionsIdx).trim();
}
