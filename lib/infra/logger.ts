/**
 * Structured JSON logger — the ONLY logging surface in the codebase.
 *
 * All log output goes through this class. Direct console.log calls are banned
 * by Biome lint rules. console.error is reserved for the Logger itself and for
 * the outer error boundary in the route handler.
 *
 * Every log line includes a correlationId (the Stripe event id) so Cloudflare
 * log queries can filter a complete request trace by a single field.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  correlationId: string;
  context?: Record<string, unknown>;
}

export class Logger {
  readonly #correlationId: string;

  /**
   * @param correlationId - Stripe event id (or a generated id at route entry).
   *   Threaded through every log line so Cloudflare can filter a full trace.
   */
  constructor(correlationId: string) {
    this.#correlationId = correlationId;
  }

  debug(event: string, context?: Record<string, unknown>): void {
    this.#write("debug", event, context);
  }

  info(event: string, context?: Record<string, unknown>): void {
    this.#write("info", event, context);
  }

  warn(event: string, context?: Record<string, unknown>): void {
    this.#write("warn", event, context);
  }

  /**
   * Logs a structured error entry. Always call this before rethrowing —
   * it is the canonical place for error context capture.
   */
  error(event: string, context?: Record<string, unknown>): void {
    this.#write("error", event, context);
  }

  #write(level: LogLevel, event: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      event,
      correlationId: this.#correlationId,
      ...(context ? { context } : {}),
    };
    // console.error is used for all levels so Cloudflare's log tail picks them up.
    // Cloudflare Workers route console.error to the structured log stream.
    console.error(JSON.stringify(entry));
  }
}
