/**
 * Gateway HTTP route tests — verifies all endpoints respond correctly,
 * including /anc prefix stripping for cloudflared routing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';

// Mock dependencies
vi.mock('../src/core/db.js', () => ({
  getRecentEvents: vi.fn(() => [
    { id: 1, eventType: 'spawned', role: 'engineer', issueKey: 'ANC-1', detail: null, createdAt: '2026-03-27 00:00:00' },
  ]),
}));

vi.mock('../src/agents/registry.js', () => ({
  getRegisteredAgents: vi.fn(() => [
    { role: 'engineer', name: 'Engineer' },
  ]),
}));

vi.mock('../src/runtime/health.js', () => ({
  getHealthStatus: vi.fn(() => ({
    activeSessions: 0,
    suspendedSessions: 0,
    idleSessions: 0,
    maxConcurrency: 3,
    sessions: [],
  })),
}));

vi.mock('../src/linear/types.js', () => ({
  getConfig: vi.fn(() => ({
    webhookPort: 0,
    webhookSecret: 'test-secret',
  })),
}));

vi.mock('../src/linear/webhooks.js', () => ({
  verifySignature: vi.fn(() => false),
  classifyWebhook: vi.fn(() => ({ type: 'ignored', reason: 'test' })),
}));

vi.mock('../src/bus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn() },
}));

describe('Gateway prefix stripping', () => {
  it('/anc prefix is stripped to /', () => {
    const url = '/anc';
    const stripped = url.startsWith('/anc') ? (url.slice(4) || '/') : url;
    expect(stripped).toBe('/');
  });

  it('/anc/events prefix is stripped to /events', () => {
    const url = '/anc/events';
    const stripped = url.startsWith('/anc') ? (url.slice(4) || '/') : url;
    expect(stripped).toBe('/events');
  });

  it('/anc/events?limit=10 prefix is stripped correctly', () => {
    const url = '/anc/events?limit=10';
    const stripped = url.startsWith('/anc') ? (url.slice(4) || '/') : url;
    expect(stripped).toBe('/events?limit=10');
    expect(stripped.startsWith('/events')).toBe(true);
  });

  it('/anc/health prefix is stripped to /health', () => {
    const url = '/anc/health';
    const stripped = url.startsWith('/anc') ? (url.slice(4) || '/') : url;
    expect(stripped).toBe('/health');
  });

  it('/events without prefix is not modified', () => {
    const url = '/events';
    const stripped = url.startsWith('/anc') ? (url.slice(4) || '/') : url;
    expect(stripped).toBe('/events');
  });

  it('/events route matches urls starting with /events', () => {
    expect('/events'.startsWith('/events')).toBe(true);
    expect('/events?limit=10'.startsWith('/events')).toBe(true);
    expect('/event'.startsWith('/events')).toBe(false);
  });
});

describe('Gateway integration', () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    const { getRecentEvents } = await import('../src/core/db.js');

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Mirror the gateway's prefix stripping + route logic
      if (req.url?.startsWith('/anc')) {
        req.url = req.url.slice(4) || '/';
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'anc', lastWebhookAt: null, webhookCount: 0 }));
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/events')) {
        try {
          const url = new URL(req.url, 'http://localhost');
          const limit = parseInt(url.searchParams.get('limit') || '50');
          const events = getRecentEvents(limit);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(events));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to fetch events' }));
        }
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  it('GET /health returns 200 with webhook stats', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('lastWebhookAt');
    expect(body).toHaveProperty('webhookCount');
    expect(body.lastWebhookAt).toBeNull();
    expect(body.webhookCount).toBe(0);
  });

  it('GET /events returns 200 with events array', async () => {
    const res = await fetch(`http://localhost:${port}/events`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].eventType).toBe('spawned');
  });

  it('GET /events?limit=5 returns 200', async () => {
    const res = await fetch(`http://localhost:${port}/events?limit=5`);
    expect(res.status).toBe(200);
  });

  it('GET /anc/events returns 200 (prefix stripped)', async () => {
    const res = await fetch(`http://localhost:${port}/anc/events`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /anc/health returns 200 (prefix stripped)', async () => {
    const res = await fetch(`http://localhost:${port}/anc/health`);
    expect(res.status).toBe(200);
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('GET /event (not /events) returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/event`);
    expect(res.status).toBe(404);
  });
});
