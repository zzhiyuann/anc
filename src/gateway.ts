/**
 * Gateway — thin HTTP webhook receiver.
 * Receives Linear webhooks, validates, classifies, and emits to the event bus.
 * Also serves health/status endpoints. Nothing else.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { bus } from './bus.js';
import { createLogger } from './core/logger.js';
import { handleApiRequest } from './api/routes.js';
import { setupWebSocket } from './api/ws.js';

const log = createLogger('gateway');
import { getConfig } from './linear/types.js';
import { verifySignature, classifyWebhook } from './linear/webhooks.js';

/** Simple MD → mobile-friendly HTML (no dependencies) */
function mdToHtml(md: string, title: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])/gm, '');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;line-height:1.6;color:#222}
h1,h2,h3{margin-top:1.5em}code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:0.9em}
ul{padding-left:1.2em}li{margin:4px 0}pre{background:#f5f5f5;padding:12px;overflow-x:auto;border-radius:6px}</style>
</head><body><p>${html}</p></body></html>`;
}

let lastWebhookAt: string | null = null;
let webhookCount = 0;

/** Returns last webhook timestamp and count for health checks. */
export function getWebhookStats() {
  return { lastWebhookAt, webhookCount };
}

async function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function startGateway(port?: number): void {
  const config = getConfig();
  const listenPort = port ?? config.webhookPort;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Strip /anc prefix (cloudflared path-based routing preserves it)
    if (req.url?.startsWith('/anc')) {
      req.url = req.url.slice(4) || '/';
    }

    // CORS headers for dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // -- Wave 2B: Claude Code hook endpoint (fast-path, local-only, BEFORE /api/v1/ delegation) --
    if (req.method === 'POST' && req.url?.startsWith('/api/v1/hooks/') && req.url.endsWith('/event')) {
      try {
        const expected = process.env.ANC_HOOK_TOKEN;
        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!expected || provided !== expected) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized hook' }));
          return;
        }

        // Path: /api/v1/hooks/:taskId/event
        const segs = req.url.split('?')[0].split('/'); // ['', 'api', 'v1', 'hooks', ':taskId', 'event']
        const taskId = segs[4];
        if (!taskId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing taskId' }));
          return;
        }

        const role = (req.headers['x-anc-agent-role'] as string | undefined) ?? 'unknown';
        const body = await readBody(req, 64 * 1024);
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
          return;
        }

        const { processHookEvent } = await import('./api/hook-handler.js');
        processHookEvent(taskId, role, payload);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (err) {
        log.error(`hook endpoint error: ${(err as Error).message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // --- API v1 routes (dashboard) ---
    if (req.url?.startsWith('/api/v1/')) {
      const handled = await handleApiRequest(req, res);
      if (handled) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
      return;
    }

    // --- Health ---
    if (req.method === 'GET' && req.url === '/health') {
      const { getRateLimitStatus } = await import('./linear/rate-limiter.js');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'anc',
        version: '0.1.0',
        uptime: Math.round(process.uptime()),
        lastChecked: new Date().toISOString(),
        rateLimit: getRateLimitStatus(),
        lastWebhookAt,
        webhookCount,
      }));
      return;
    }

    // --- Health Detailed ---
    if (req.method === 'GET' && req.url === '/health/detailed') {
      const start = Date.now();
      const { getRateLimitStatus } = await import('./linear/rate-limiter.js');
      const { getDb } = await import('./core/db.js');
      const { getTrackedSessions } = await import('./runtime/health.js');
      const { getQueue } = await import('./routing/queue.js');
      const { getTrippedBreakers } = await import('./runtime/circuit-breaker.js');

      const components: Record<string, { status: string; [key: string]: unknown }> = {};

      // Database health
      try {
        const dbStart = Date.now();
        const d = getDb();
        d.prepare('SELECT 1').get();
        components.database = { status: 'ok', latency_ms: Date.now() - dbStart };
      } catch (err) {
        components.database = { status: 'error', error: (err as Error).message };
      }

      // Linear API rate limiter
      const rateLimit = getRateLimitStatus();
      components.linear_api = {
        status: rateLimit.tokens === 0 ? 'degraded' : 'ok',
        rate_limit_remaining: rateLimit.tokens,
        rate_limit_max: rateLimit.max,
      };

      // Dispatch queue
      const queued = getQueue('queued');
      const processing = getQueue('processing');
      const queueDepth = queued.length + processing.length;
      components.webhook_queue = {
        status: queueDepth > 20 ? 'degraded' : 'ok',
        depth: queueDepth,
        queued: queued.length,
        processing: processing.length,
      };

      // Active sessions
      const sessions = getTrackedSessions();
      const activeCt = sessions.filter(s => s.state === 'active').length;
      const idleCt = sessions.filter(s => s.state === 'idle').length;
      const suspendedCt = sessions.filter(s => s.state === 'suspended').length;
      components.active_sessions = {
        status: 'ok',
        count: activeCt,
        idle: idleCt,
        suspended: suspendedCt,
        total: sessions.length,
      };

      // Circuit breakers
      const tripped = getTrippedBreakers();
      components.circuit_breakers = {
        status: tripped.length > 0 ? 'degraded' : 'ok',
        tripped_count: tripped.length,
        tripped: tripped.map(b => ({
          issueKey: b.issueKey,
          failCount: b.failCount,
          backoff_remaining_ms: Math.max(0, b.backoffUntil - Date.now()),
        })),
      };

      // Webhooks
      components.webhooks = {
        status: 'ok',
        last_received: lastWebhookAt,
        total_count: webhookCount,
      };

      // Overall rollup
      const overallStatus = Object.values(components).some(c => c.status === 'error') ? 'error'
        : Object.values(components).some(c => c.status === 'degraded') ? 'degraded' : 'ok';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: overallStatus,
        service: 'anc',
        version: '0.1.0',
        uptime: Math.round(process.uptime()),
        components,
        response_time_ms: Date.now() - start,
      }));
      return;
    }

    // --- Status ---
    if (req.method === 'GET' && req.url === '/status') {
      // Import dynamically to avoid circular deps
      const { getRegisteredAgents } = await import('./agents/registry.js');
      const { getHealthStatus } = await import('./runtime/health.js');
      const agents = getRegisteredAgents().map(a => {
        const health = getHealthStatus(a.role);
        return { role: a.role, name: a.name, ...health };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents, uptime_seconds: Math.round(process.uptime()) }));
      return;
    }

    // --- Events (audit log) ---
    if (req.method === 'GET' && req.url?.startsWith('/events')) {
      try {
        const { getRecentEvents } = await import('./core/db.js');
        const url = new URL(req.url, 'http://localhost');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const events = getRecentEvents(limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
      } catch (err) {
        log.error(`/events error: ${(err as Error).message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch events' }));
      }
      return;
    }

    // --- Webhook ---
    if (req.method === 'POST' && (req.url === '/webhook' || req.url === '/')) {
      const body = await readBody(req);
      const signature = req.headers['linear-signature'] as string | undefined;

      if (!verifySignature(body, signature, config.webhookSecret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // Track webhook receipt for health checks
      lastWebhookAt = new Date().toISOString();
      webhookCount++;

      // Respond immediately (Linear expects fast 200)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      // Classify and emit
      try {
        const payload = JSON.parse(body);
        const event = req.headers['linear-event'] as string || 'unknown';
        const ts = new Date().toLocaleTimeString();
        const classified = classifyWebhook(event, payload);

        if (classified.type === 'ignored') {
          log.debug(`ignored: ${classified.reason}`);
          return;
        }

        log.info(`webhook: ${classified.type}`);

        switch (classified.type) {
          case 'issue.created':
            await bus.emit('webhook:issue.created', { issue: classified.issue });
            break;
          case 'issue.updated':
            await bus.emit('webhook:issue.updated', { issue: classified.issue, changes: classified.changes });
            break;
          case 'comment.created':
            await bus.emit('webhook:comment.created', { comment: classified.comment, issue: classified.issue });
            break;
          // AgentSession events are intentionally ignored.
          // Agent work is triggered via issue.created and comment.created instead.
          case 'session.created':
          case 'session.prompted':
            log.debug(`Ignoring AgentSession event: ${classified.type}`);
            break;
        }
      } catch (err) {
        log.error(`Parse error: ${(err as Error).message}`);
      }
      return;
    }

    // --- Dispatch endpoint (for agent SDK) ---
    if (req.method === 'POST' && req.url === '/dispatch') {
      const body = await readBody(req);
      try {
        const { handleDispatchRequest } = await import('./routing/router.js');
        const result = await handleDispatchRequest(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    // --- Plan announcement endpoint (for agent SDK + hook guard) ---
    if (req.method === 'POST' && req.url === '/plan-announce') {
      const body = await readBody(req);
      try {
        const { role, issueKey, plan } = JSON.parse(body);
        const { getRootLink } = await import('./bridge/mappings.js');
        const { replyInDiscord, postToDiscord } = await import('./channels/discord.js');

        const rootLink = getRootLink(issueKey);
        if (rootLink) {
          await replyInDiscord(rootLink.discordMessageId, rootLink.discordChannelId,
            `**[${role}]** 🚀 ${plan}`);
        } else {
          await postToDiscord(role, `🚀 **${issueKey}**: ${plan}`);
        }

        // Mark announced in workspace
        const config = getConfig();
        const markerPath = join(config.workspaceBase, issueKey, '.anc', 'plan-announced');
        const markerDir = dirname(markerPath);
        if (!existsSync(markerDir)) mkdirSync(markerDir, { recursive: true });
        writeFileSync(markerPath, '', 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    // --- Group message endpoint (for agent SDK) ---
    if (req.method === 'POST' && req.url === '/group-post') {
      const body = await readBody(req);
      try {
        const { role, message } = JSON.parse(body);
        const { postToDiscord } = await import('./channels/discord.js');
        await postToDiscord(role ?? 'system', message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    // --- Assets endpoint: serve static files (avatars, etc.) ---
    if (req.method === 'GET' && req.url?.startsWith('/assets/')) {
      const urlPath = decodeURIComponent(req.url.slice(8));
      if (urlPath.includes('..')) { res.writeHead(403); res.end('Forbidden'); return; }

      const { dirname: dn } = await import('path');
      const { fileURLToPath } = await import('url');
      const thisFile = fileURLToPath(import.meta.url);
      const assetsDir = join(dn(thisFile), '..', 'assets');
      const filePath = join(assetsDir, urlPath);

      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }

      const ext = extname(filePath).toLowerCase();
      const mimes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif' };
      res.writeHead(200, {
        'Content-Type': mimes[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(readFileSync(filePath));
      return;
    }

    // --- Docs endpoint: serve workspace files with MD→HTML conversion ---
    if (req.method === 'GET' && req.url?.startsWith('/docs/')) {
      const urlPath = decodeURIComponent(req.url.slice(6)); // strip /docs/
      const parts = urlPath.split('/');
      if (parts.length < 2) { res.writeHead(400); res.end('Usage: /docs/{issueKey}/{filename}'); return; }

      const issueKey = parts[0];
      const filename = parts.slice(1).join('/');
      const config = getConfig();
      const filePath = join(config.workspaceBase, issueKey, filename);

      // Security: prevent path traversal
      if (!filePath.startsWith(config.workspaceBase) || filename.includes('..')) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      if (!existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return;
      }

      const content = readFileSync(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();

      if (ext === '.md') {
        // Convert markdown to simple HTML (mobile-friendly)
        const html = mdToHtml(content, filename);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html', '.txt': 'text/plain', '.json': 'application/json',
          '.yaml': 'text/plain', '.yml': 'text/plain', '.ts': 'text/plain',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
        res.end(content);
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Set up WebSocket upgrade on the same server
  setupWebSocket(server);

  server.listen(listenPort, () => {
    log.info(`ANC Gateway listening on http://localhost:${listenPort}`);
  });
}
