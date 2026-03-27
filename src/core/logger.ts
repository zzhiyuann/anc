/**
 * Structured logger — replaces raw console.log with leveled, contextual logging.
 * Writes to stdout + rotating daily log file at ~/.anc/logs/anc-{date}.log.
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS: Record<LogLevel, string> = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };

// ANSI colors for stdout (stripped from file output)
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[2m',   // dim
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

const LOG_DIR = join(homedir(), '.anc', 'logs');

let minLevel: LogLevel = (process.env.ANC_LOG_LEVEL as LogLevel) ?? 'info';
let logToFile = true;

export function setLogLevel(level: LogLevel): void { minLevel = level; }
export function setFileLogging(enabled: boolean): void { logToFile = enabled; }

function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return join(LOG_DIR, `anc-${date}.log`);
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatMessage(level: LogLevel, component: string, message: string, ctx?: LogContext): string {
  const ts = formatTimestamp();
  const lvl = LEVEL_LABELS[level];
  const ctxStr = ctx?.issueKey ? ` [${ctx.issueKey}]` : ctx?.role ? ` [${ctx.role}]` : '';
  return `${ts} ${lvl} [${component}]${ctxStr} ${message}`;
}

export interface LogContext {
  role?: string;
  issueKey?: string;
}

class Logger {
  constructor(private component: string) {}

  debug(msg: string, ctx?: LogContext): void { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: LogContext): void { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.log('error', msg, ctx); }

  private log(level: LogLevel, msg: string, ctx?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const plain = formatMessage(level, this.component, msg, ctx);

    // Stdout with color
    const color = LEVEL_COLORS[level];
    process.stdout.write(`${color}${plain}${RESET}\n`);

    // File (no color)
    if (logToFile) {
      try {
        ensureLogDir();
        appendFileSync(getLogFilePath(), plain + '\n');
      } catch {
        // File logging failure is non-fatal
      }
    }
  }
}

/** Create a logger for a component (e.g., 'gateway', 'runner', 'scheduler') */
export function createLogger(component: string): Logger {
  return new Logger(component);
}
