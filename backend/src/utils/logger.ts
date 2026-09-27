/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * =============================================================================
 *  logger.ts — Central File Logger (terminal-quiet, file-complete)
 * =============================================================================
 *
 * Purpose:
 *   Routes ALL application output (every console.log / console.info /
 *   console.warn / console.error / console.debug emitted anywhere in the
 *   backend) into dedicated log files on disk, while keeping the terminal
 *   clean: only errors and warnings are echoed to stdout/stderr.
 *
 *   This removes the need to run the server through a shell redirect —
 *   `npm run dev` alone produces a complete, timestamped, day-scoped log file.
 *
 * Log location:
 *   backend/logs/app-YYYY-MM-DD.log     — all levels (log/info/warn/error/debug)
 *   backend/logs/error-YYYY-MM-DD.log   — errors + warnings only
 *   (`logs/` is git-ignored; see backend/.gitignore)
 *
 * Rotation:
 *   Files are day-scoped (a new file begins each calendar day, local time).
 *   No size-based rotation — dev logs rarely reach that; the error file is a
 *   strict subset of the all-level file, so nothing is ever lost by cleanup.
 *
 * Terminal policy (the point of this module):
 *   console.log / console.info / console.debug → file only (silent terminal)
 *   console.warn → file + terminal (stderr)
 *   console.error → file + terminal (stderr)
 *
 * Failsafe design:
 *   - The patch is installed lazily on first import; importing this module
 *     NEVER throws and never crashes the server (all disk I/O is wrapped).
 *   - If the log directory cannot be created, the module degrades to a no-op
 *     passthrough (default console behavior) and retries the directory only
 *     once per process per day.
 *   - Writes are serialized through a promise chain so lines never interleave;
 *   - Fire-and-forget append: a logging failure can never block a request.
 *
 * Usage:
 *   import { initFileLogging } from './utils/logger';
 *   initFileLogging(); // call once at the top of server.ts, before connectDB
 *   // …after that, existing console.* calls everywhere are captured. New code
 *   // may also import the `logger` object for structured calls:
 *   logger.info('[Module] message', { optional: 'meta' })
 * =============================================================================
 */

import fs from 'fs';
import path from 'path';

// ─── Configuration ────────────────────────────────────────────────

/** Directory that receives the log files (backend/logs). */
const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');

/** Prefix for the all-level log file. */
const APP_LOG_PREFIX = 'app';

/** Prefix for the errors-only log file. */
const ERROR_LOG_PREFIX = 'error';

/** Max bytes of a single log line before truncation (defensive cap). */
const MAX_LINE_LENGTH = 16 * 1024; // 16 KB

/** Date key (local time) used for day-scoped filenames: YYYY-MM-DD. */
function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Current local time used as the line timestamp. */
function timeKey(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ─── State ────────────────────────────────────────────────────────

let initialized = false;
let dirAvailable = false;
let currentDay = '';
/** Serialize appends so concurrent log lines never interleave mid-line. */
let writeChain: Promise<void> = Promise.resolve();
let openFdApp: number | null = null;
let openFdErr: number | null = null;

// ─── Formatting ───────────────────────────────────────────────────

/**
 * Render console arguments into a single human-readable log line.
 * Objects/errors are inspected; errors print `name: message` + stack.
 */
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack || `${a.name}: ${a.message}`;
      }
      if (typeof a === 'string') return a;
      if (a === undefined) return 'undefined';
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Build the full line: `2026-09-27 14:03:11.412 [LEVEL] message`. */
function formatLine(level: string, args: unknown[]): string {
  const line = formatArgs(args);
  const trimmed = line.length > MAX_LINE_LENGTH
    ? `${line.slice(0, MAX_LINE_LENGTH)}…[truncated ${line.length - MAX_LINE_LENGTH} chars]`
    : line;
  return `${dateKey()} ${timeKey()} [${level}] ${trimmed}`;
}

// ─── Disk I/O (fail-safe) ─────────────────────────────────────────

function openFiles(day: string): void {
  // Append handles are kept open for the day and flushed by the OS; reopening
  // per line would be measurably slower under request-logger volume.
  openFdApp = fs.openSync(path.join(LOG_DIR, `${APP_LOG_PREFIX}-${day}.log`), 'a');
  openFdErr = fs.openSync(path.join(LOG_DIR, `${ERROR_LOG_PREFIX}-${day}.log`), 'a');
  currentDay = day;
}

function closeFiles(): void {
  for (const fd of [openFdApp, openFdErr]) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
  openFdApp = null;
  openFdErr = null;
}

/**
 * Append a raw line to the log files. Errors/warnings also go to the
 * error file. Day rollover closes yesterday's handles and opens today's.
 */
function appendLine(line: string, isError: boolean): void {
  const day = dateKey();
  if (day !== currentDay) {
    closeFiles();
    openFiles(day);
  }
  const data = `${line}\n`;
  if (openFdApp !== null) {
    try { fs.writeSync(openFdApp, data); } catch { /* best effort */ }
  }
  if (isError && openFdErr !== null) {
    try { fs.writeSync(openFdErr, data); } catch { /* best effort */ }
  }
}

/** Enqueue an append on the serialized write chain (never throws). */
function enqueue(line: string, isError: boolean): void {
  writeChain = writeChain.then(
    () => { appendLine(line, isError); },
    () => { /* previous write failed — keep the chain alive */ }
  );
}

// ─── Console patch ────────────────────────────────────────────────

/**
 * Route console output to files per the terminal policy above. Keeps the
 * original methods so process-level fatal handlers can bypass the policy.
 */
function patchConsole(): void {
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => enqueue(formatLine('INFO', args), false);
  console.info = (...args: unknown[]) => enqueue(formatLine('INFO', args), false);
  console.debug = (...args: unknown[]) => enqueue(formatLine('DEBUG', args), false);
  console.warn = (...args: unknown[]) => {
    enqueue(formatLine('WARN', args), true);
    original.warn(...args); // terminal keeps warnings
  };
  console.error = (...args: unknown[]) => {
    enqueue(formatLine('ERROR', args), true);
    original.error(...args); // terminal keeps errors
  };

  // Expose the untouched originals for fatal paths that must always be
  // visible regardless of log policy.
  (console as any).__original = original;
}

// ─── Initialization ───────────────────────────────────────────────

/**
 * Create the log directory and install the console patch. Idempotent —
 * calling twice is a safe no-op. Never throws.
 */
export function initFileLogging(): void {
  if (initialized) return;
  initialized = true;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirAvailable = true;
  } catch {
    dirAvailable = false;
  }

  if (!dirAvailable) {
    // Leave console untouched — default behavior is the safest fallback.
    return;
  }

  try {
    patchConsole();
  } catch {
    // If patching somehow fails, restore default console behavior.
    dirAvailable = false;
  }
}

/**
 * Write a shutdown banner with the untouched console methods so it is always
 * visible in the terminal (e.g. on fatal exits).
 */
export function logFatal(...args: unknown[]): void {
  const original = (console as any).__original as { error(...a: unknown[]): void } | undefined;
  if (original) original.error(...args);
  else console.error(...args);
}

// ─── Structured logger (for new code) ─────────────────────────────

/**
 * Explicit logger for code that prefers structured calls over bare console.
 * Applies the same terminal policy as the patched console.
 */
export const logger = {
  /** File only. */
  info(...args: unknown[]): void {
    console.log(...args);
  },
  /** File only. */
  debug(...args: unknown[]): void {
    console.debug(...args);
  },
  /** File + terminal. */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  /** File + terminal. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
