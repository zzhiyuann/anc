/**
 * Task complexity estimation tests.
 */
import { describe, it, expect } from 'vitest';
import { estimateComplexity, type Complexity } from '../src/core/task-complexity.js';

describe('estimateComplexity', () => {
  it('classifies short description as trivial', () => {
    const result = estimateComplexity({
      title: 'Fix typo',
      description: 'Small fix',
      priority: 3,
    });
    expect(result.complexity).toBe('trivial');
    expect(result.shouldDecompose).toBe(false);
  });

  it('classifies null/empty description as trivial', () => {
    const result = estimateComplexity({
      title: 'Bump version',
      description: null,
      priority: 3,
    });
    expect(result.complexity).toBe('trivial');
    expect(result.shouldDecompose).toBe(false);
  });

  it('classifies long description (>300 chars) as complex', () => {
    const longDesc = 'This task requires implementing a new authentication system. ' +
      'We need to set up OAuth2 with multiple providers, create the database schema, ' +
      'build the middleware layer, add rate limiting, write comprehensive tests, ' +
      'update the API documentation, and deploy to staging for QA review. ' +
      'Additionally, we need to migrate existing users and handle backward compatibility. ' +
      'The frontend needs new login/signup flows with proper error handling.';
    expect(longDesc.length).toBeGreaterThan(300);

    const result = estimateComplexity({
      title: 'Auth system',
      description: longDesc,
      priority: 2,
    });
    expect(result.complexity).toBe('complex');
    expect(result.shouldDecompose).toBe(true);
  });

  it('classifies tasks with complex keywords as complex', () => {
    const result = estimateComplexity({
      title: 'Refactor the payment module',
      description: 'Need to refactor the entire payment processing pipeline.',
      priority: 2,
    });
    expect(result.complexity).toBe('complex');
    expect(result.shouldDecompose).toBe(true);
  });

  it('classifies moderate description without keywords as standard', () => {
    const result = estimateComplexity({
      title: 'Add user preferences page',
      description: 'Create a new page where users can update their display name, email notifications, and theme preference. Include form validation.',
      priority: 3,
    });
    expect(result.complexity).toBe('standard');
    expect(result.shouldDecompose).toBe(false);
  });

  it('treats high-priority tasks with substantial description as complex', () => {
    const result = estimateComplexity({
      title: 'Critical billing fix',
      description: 'Users are being double-charged when they upgrade their plan. Need to audit the Stripe webhook handler, fix the idempotency logic, reconcile affected accounts, and add monitoring alerts to catch this in the future.',
      priority: 1,
    });
    expect(result.complexity).toBe('complex');
    expect(result.shouldDecompose).toBe(true);
  });

  it('does not flag trivial-keyword tasks as trivial when complex keywords also present', () => {
    const result = estimateComplexity({
      title: 'Cleanup and refactor auth module',
      description: 'Remove unused code and refactor the authentication module for better maintainability.',
      priority: 3,
    });
    expect(result.complexity).toBe('complex');
    expect(result.shouldDecompose).toBe(true);
  });

  it('returns a reason string for every classification', () => {
    const cases: Array<{ title: string; description: string | null; priority: number }> = [
      { title: 'Fix typo', description: null, priority: 3 },
      { title: 'Add feature', description: 'A moderate-length description with enough detail.', priority: 3 },
      { title: 'Migrate database', description: 'Full migration of the database schema with data backfill.', priority: 1 },
    ];
    for (const c of cases) {
      const result = estimateComplexity(c);
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(5);
    }
  });
});
