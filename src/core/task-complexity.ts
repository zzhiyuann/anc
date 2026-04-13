/**
 * Task complexity estimation.
 *
 * Used by the runner to decide whether to suggest decomposition
 * before an agent starts working.
 */

export type Complexity = 'trivial' | 'standard' | 'complex';

export interface ComplexityResult {
  complexity: Complexity;
  shouldDecompose: boolean;
  reason: string;
}

const TRIVIAL_KEYWORDS = [
  'typo', 'rename', 'bump', 'update version', 'fix lint', 'fix typo',
  'add comment', 'remove unused', 'cleanup', 'nit',
];

const COMPLEX_KEYWORDS = [
  'refactor', 'migrate', 'redesign', 'rewrite', 'implement',
  'build out', 'integrate', 'end-to-end', 'multi-step', 'architecture',
  'overhaul', 'system-wide', 'cross-cutting', 'full-stack',
];

export function estimateComplexity(task: {
  title: string;
  description: string | null;
  priority: number;
}): ComplexityResult {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();
  const descLen = (task.description ?? '').length;

  // Trivial: very short description or trivial keywords
  if (descLen < 50 || TRIVIAL_KEYWORDS.some(kw => text.includes(kw))) {
    // Only trivial if no complex keywords override
    if (!COMPLEX_KEYWORDS.some(kw => text.includes(kw)) && descLen < 50) {
      return {
        complexity: 'trivial',
        shouldDecompose: false,
        reason: descLen < 50
          ? 'Short description suggests simple task'
          : 'Trivial keyword detected',
      };
    }
  }

  // Complex: long description or complex keywords or high priority with substance
  if (descLen > 300 || COMPLEX_KEYWORDS.some(kw => text.includes(kw))) {
    return {
      complexity: 'complex',
      shouldDecompose: true,
      reason: descLen > 300
        ? `Long description (${descLen} chars) suggests multi-faceted task`
        : `Complex keyword detected in task text`,
    };
  }

  // High-priority tasks with moderate description are borderline
  if (task.priority <= 1 && descLen > 150) {
    return {
      complexity: 'complex',
      shouldDecompose: true,
      reason: 'High priority with substantial description',
    };
  }

  return {
    complexity: 'standard',
    shouldDecompose: false,
    reason: 'Standard complexity — no decomposition needed',
  };
}
