/**
 * Router — single routing decision function.
 * Takes an event context, returns which agent should handle it.
 */

import type { RouteDecision, RouteTarget, CommentPayload, IssuePayload, AgentRole } from '../linear/types.js';
import { loadRoutingConfig, buildMentionRegex, extractRoleFromMatch, detectMentionByUserId, isSelfNote, type RoutingConfig } from './rules.js';
import { getRegisteredAgents, getAgentByLinearUserId } from '../agents/registry.js';
import { enqueue } from './queue.js';

// --- Comment Routing ---

export interface CommentContext {
  comment: CommentPayload;
  issue: IssuePayload;
  parentCommentAuthorRole?: AgentRole;  // if replying to an agent's comment
  lastActiveAgent?: AgentRole;          // last agent that worked on this issue
}

export function routeComment(ctx: CommentContext): RouteDecision {
  const config = loadRoutingConfig();
  const { comment, issue } = ctx;

  // Self-note check
  if (isSelfNote(comment.body, config)) {
    return { target: 'skip', reason: 'self-note prefix', issueKey: issue.identifier, priority: 0 };
  }

  // Check if commenter is an agent (prevent loops)
  const agents = getRegisteredAgents();
  const isAgent = agents.some(a => a.linearUserId === comment.userId);
  if (isAgent) {
    return { target: 'skip', reason: 'comment from agent', issueKey: issue.identifier, priority: 0 };
  }

  // Walk through rules in order
  for (const rule of config.comment_routing) {
    switch (rule.target) {
      case 'mentioned_agent': {
        // Method 1: plain text @Role
        const regex = buildMentionRegex(config);
        const match = comment.body.match(regex);
        if (match) {
          const role = extractRoleFromMatch(match);
          if (role) return { target: role, reason: `@${role} mentioned`, issueKey: issue.identifier, priority: issue.priority };
        }
        // Method 2: Linear user ID in body (Linear's native @mention format)
        const byId = detectMentionByUserId(comment.body, agents);
        if (byId) {
          return { target: byId, reason: `@${byId} mentioned (by ID)`, issueKey: issue.identifier, priority: issue.priority };
        }
        break;
      }
      case 'parent_agent': {
        if (comment.parentId && ctx.parentCommentAuthorRole) {
          return { target: ctx.parentCommentAuthorRole, reason: 'reply to agent comment', issueKey: issue.identifier, priority: issue.priority };
        }
        break;
      }
      case 'delegate': {
        if (issue.delegateId) {
          const agent = getAgentByLinearUserId(issue.delegateId);
          if (agent) {
            return { target: agent.role, reason: 'issue delegate', issueKey: issue.identifier, priority: issue.priority };
          }
        }
        break;
      }
      case 'assignee': {
        if (issue.assigneeId) {
          const agent = getAgentByLinearUserId(issue.assigneeId);
          if (agent) {
            return { target: agent.role, reason: 'issue assignee', issueKey: issue.identifier, priority: issue.priority };
          }
        }
        break;
      }
      case 'last_agent': {
        if (ctx.lastActiveAgent) {
          return { target: ctx.lastActiveAgent, reason: 'last active agent', issueKey: issue.identifier, priority: issue.priority };
        }
        break;
      }
    }
  }

  return { target: config.comment_default as RouteTarget, reason: 'no matching rule', issueKey: issue.identifier, priority: issue.priority };
}

// --- Issue Routing ---

export function routeIssue(issue: IssuePayload): RouteDecision {
  const config = loadRoutingConfig();
  const labels = issue.labels ?? [];

  for (const rule of config.issue_routing) {
    if (rule.label && labels.some(l => l.toLowerCase() === rule.label!.toLowerCase())) {
      return { target: rule.target, reason: `label: ${rule.label}`, issueKey: issue.identifier, priority: issue.priority };
    }
    if (rule.project && issue.project?.toLowerCase() === rule.project.toLowerCase()) {
      return { target: rule.target, reason: `project: ${rule.project}`, issueKey: issue.identifier, priority: issue.priority };
    }
    if (rule.titlePattern) {
      const regex = new RegExp(rule.titlePattern, 'i');
      if (regex.test(issue.title)) {
        return { target: rule.target, reason: `title: ${rule.titlePattern}`, issueKey: issue.identifier, priority: issue.priority };
      }
    }
  }

  return { target: config.issue_default, reason: 'default routing', issueKey: issue.identifier, priority: issue.priority };
}

// --- Dispatch request (from agent SDK) ---

export interface DispatchRequest {
  from?: AgentRole;
  target: AgentRole;
  issueKey: string;
  context?: string;
  type: 'dispatch' | 'handoff' | 'ask';
}

export async function handleDispatchRequest(req: DispatchRequest): Promise<{ ok: boolean; action: string; detail: string }> {
  const config = loadRoutingConfig();
  if (!config.agent_roles.includes(req.target)) {
    return { ok: false, action: 'error', detail: `Unknown agent role: ${req.target}. Known: ${config.agent_roles.join(', ')}` };
  }

  // Enqueue the work
  enqueue({
    issueKey: req.issueKey,
    issueId: '',  // will be resolved at spawn time
    agentRole: req.target,
    priority: 2,  // high priority for explicit dispatches
    context: req.context ? `[${req.type} from ${req.from ?? 'unknown'}] ${req.context}` : undefined,
  });

  return { ok: true, action: req.type, detail: `${req.type} to ${req.target} on ${req.issueKey}` };
}
