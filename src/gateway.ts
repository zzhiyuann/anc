/**
 * Gateway — thin HTTP webhook receiver.
 * Receives Linear webhooks, validates, classifies, and emits to the event bus.
 * Also serves health/status endpoints. Nothing else.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import chalk from 'chalk';
import { bus } from './bus.js';
import { getConfig } from './linear/types.js';
import { verifySignature, classifyWebhook } from './linear/webhooks.js';

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
    // --- Health ---
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'anc', uptime: Math.round(process.uptime()) }));
      return;
    }

    // --- Status ---
    if (req.method === 'GET' && req.url === '/status') {
      // Import dynamically to avoid circular deps
      const { getRegisteredAgents } = await import('./agents/registry.js');
      const { getHealthStatus } = await import('./runtime/health.js');
      const agents = getRegisteredAgents().map(a => ({
        role: a.role,
        name: a.name,
        ...getHealthStatus(a.role),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents, uptime: Math.round(process.uptime()) }));
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
          console.log(chalk.dim(`[${ts}] ignored: ${classified.reason}`));
          return;
        }

        console.log(chalk.bold(`[${ts}] ${classified.type}`));

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
        console.error(chalk.red(`[gateway] Parse error: ${(err as Error).message}`));
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
    console.log(chalk.bold(`ANC Gateway listening on http://localhost:${listenPort}`));
  });
}
