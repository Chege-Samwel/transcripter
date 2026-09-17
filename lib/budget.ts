/**
 * Invocation time budget.
 *
 * Vercel kills a function invocation at its configured `maxDuration` and
 * answers the client with a bare `504 Gateway Timeout`: no body, no error
 * event, nothing the UI can explain. So a route that fans out to slow upstream
 * APIs must finish its own work before the platform does. This module turns
 * "we have N ms of function time" into per-attempt timeouts and a hard stop,
 * so the route always ends with a JSON response instead of being killed.
 *
 * Pure and dependency-free so it can be exercised without a Next runtime.
 */

export type Deadline = {
  /** Total budget in ms this deadline was created with. */
  readonly limit: number;
  /** Milliseconds left before the platform would kill the invocation. */
  remaining(): number;
  /** True when at least `min` ms are left, i.e. another attempt can start. */
  hasRoom(min: number): boolean;
};

/**
 * Creates a deadline `limitMs` from "now". `now`/`monotonic` are injectable for
 * tests; production uses Date.now().
 */
export function createDeadline(limitMs: number, monotonic: () => number = Date.now): Deadline {
  const startedAt = monotonic();
  const limit = Math.max(0, Math.floor(limitMs));
  return {
    limit,
    remaining: () => Math.max(0, limit - (monotonic() - startedAt)),
    hasRoom: (min: number) => limit - (monotonic() - startedAt) >= min,
  };
}

/**
 * Timeout for one upstream attempt.
 *
 * Every model in the chain gets a fair slice of what is left, so one slow
 * primary cannot consume the whole invocation and starve the fallbacks. The
 * result is clamped to [`minMs`, `capMs`] and floored at 0 when the deadline
 * has already passed (callers check `hasRoom` before attempting).
 */
export function attemptTimeout(deadline: Deadline, chainLength: number, minMs: number, capMs: number) {
  const models = Math.max(1, Math.floor(chainLength));
  const share = Math.floor(deadline.remaining() / models);
  return Math.max(0, Math.min(capMs, Math.max(minMs, share)));
}
