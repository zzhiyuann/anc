/**
 * WebSocket server for real-time dashboard updates.
 * Upgrades connections on /ws path.
 * Broadcasts bus events to all connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { bus } from '../bus.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { getHealthStatus, getTrackedSessions } from '../runtime/health.js';
import { getQueue } from '../routing/queue.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ws');

let wss: WebSocketServer | null = null;

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
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    log.info('Dashboard client connected');
    // Send initial state snapshot
    ws.send(JSON.stringify({ type: 'snapshot', data: buildSnapshot(), ts: Date.now() }));

    ws.on('close', () => log.debug('Dashboard client disconnected'));
    ws.on('error', (err) => log.error(`WS error: ${err.message}`));
  });

  // Subscribe to bus events and relay to clients
  const events = [
    'agent:spawned', 'agent:completed', 'agent:failed',
    'agent:idle', 'agent:suspended', 'agent:resumed',
    'queue:enqueued', 'queue:drain',
  ] as const;

  for (const event of events) {
    bus.on(event, (data) => broadcast(event, data));
  }

  log.info('WebSocket server ready on /ws');
}
