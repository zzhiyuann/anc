/**
 * Gateway — thin HTTP webhook receiver.
 * Receives Linear webhooks, validates, classifies, and emits to the event bus.
 * Also serves health/status endpoints. Nothing else.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { bus } from './bus.js';
import { createLogger } from './core/logger.js';

const log = createLogger('gateway');
import { getConfig } from './linear/types.js';
import { verifySignature, classifyWebhook } from './linear/webhooks.js';

let lastWebhookAt: string | null = null;
let webhookCount = 0;

/** Returns last webhook timestamp and count for health checks. */
export function getWebhookStats() {
  return { lastWebhookAt, webhookCount };
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
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

    // --- Health ---
    if (req.method === 'GET' && req.url === '/health') {
      const { getRateLimitStatus } = await import('./linear/rate-limiter.js');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'anc',
        uptime: Math.round(process.uptime()),
        rateLimit: getRateLimitStatus(),
        lastWebhookAt,
        webhookCount,
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
      res.end(JSON.stringify({ agents, uptime: Math.round(process.uptime()) }));
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
          case 'session.created':
            await bus.emit('webhook:session.created', { session: classified.session });
            break;
          case 'session.prompted':
            await bus.emit('webhook:session.prompted', { session: classified.session, prompt: classified.prompt });
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

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(listenPort, () => {
    log.info(`ANC Gateway listening on http://localhost:${listenPort}`);
  });
}
