/**
 * WebSocket server for real-time dashboard updates.
 * Upgrades connections on /ws path.
 * Broadcasts bus events to all connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { bus } from '../bus.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { getHealthStatus, getTrackedSessions, hasCapacity } from '../runtime/health.js';
import { getQueue } from '../routing/queue.js';
import { createLogger } from '../core/logger.js';
import { checkAuth } from './routes.js';

const log = createLogger('ws');

let wss: WebSocketServer | null = null;
const unsubscribers: Array<() => void> = [];

/** Broadcast a JSON message to all connected clients */
function broadcast(type: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/** Build initial state snapshot for newly connected clients */
function buildSnapshot(): unknown {
  const agents = getRegisteredAgents().map(a => ({
    role: a.role,
    name: a.name,
    hasCapacity: hasCapacity(a.role),
    ...getHealthStatus(a.role),
  }));
  const sessions = getTrackedSessions().map(s => ({
    role: s.role,
    issueKey: s.issueKey,
    state: s.state,
    spawnedAt: s.spawnedAt,
    priority: s.priority,
  }));
  const queue = getQueue('queued');

  return { agents, sessions, queue, uptime: Math.round(process.uptime()) };
}

/** Set up WebSocket upgrade handling on an existing HTTP server */
export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Strip /anc prefix (same as gateway)
    const url = req.url?.replace(/^\/anc/, '') ?? '';
    if (url !== '/ws') {
      socket.destroy();
      return;
    }
    // Auth: localhost allowed; remote requires ANC_API_TOKEN bearer token.
    if (!checkAuth(req)) {
      // 1008 = policy violation; write an HTTP 401 on the raw socket and close.
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n'
      );
      socket.destroy();
      log.warn('WS upgrade rejected: unauthorized');
      return;
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    log.info('Dashboard client connected');
    // Send initial state snapshot
    ws.send(JSON.stringify({ type: 'snapshot', data: buildSnapshot(), ts: Date.now() }));

    ws.on('message', (data) => {
      const text = data.toString();
      if (text === 'ping') { ws.send('pong'); return; }
      // Ignore other messages — dashboard is read-only
    });

    ws.on('close', () => log.debug('Dashboard client disconnected'));
    ws.on('error', (err) => log.error(`WS error: ${err.message}`));
  });

  // Subscribe to bus events and relay to clients
  const events = [
    // Agent lifecycle
    'agent:spawned', 'agent:completed', 'agent:failed',
    'agent:idle', 'agent:suspended', 'agent:resumed',
    'agent:health', 'agent:blocked', 'agent:crashed',
    'agent:process-event',
    // Queue & system
    'queue:enqueued', 'queue:drain',
    'system:budget-alert',
    // Webhooks
    'webhook:issue.created', 'webhook:comment.created',
    // Task events — all types so dashboard updates in real-time
    'task:created', 'task:commented', 'task:dispatched', 'task:completed',
    'task:updated', 'task:state-changed', 'task:progress',
    'task:feedback-ready', 'task:all-children-done',
    // Notifications
    'notification:created',
    // Config & lifecycle
    'agent:config-changed',
    'task:deleted',
    'config:updated',
  ] as const;

  for (const event of events) {
    const unsub = bus.on(event, (data) => broadcast(event, data));
    unsubscribers.push(unsub);
  }

  log.info('WebSocket server ready on /ws');
}

/** Tear down WebSocket server: unsubscribe all bus listeners and close server. */
export function teardownWebSocket(): void {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch { /* ignore */ }
  }
  unsubscribers.length = 0;
  if (wss) {
    try { wss.close(); } catch { /* ignore */ }
    wss = null;
  }
}
