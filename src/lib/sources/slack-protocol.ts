/**
 * Slack request verification and command parsing.
 *
 * Deliberately free of database imports: this is the code path that decides
 * whether an unauthenticated request gets to write to the portfolio, so it
 * must be directly testable.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Slack's own guidance: reject anything older than five minutes. */
const REPLAY_WINDOW_SECONDS = 300

/**
 * Verify a Slack request signature against the raw body.
 *
 * Comparison is constant-time so the endpoint cannot be used as an oracle, and
 * every failure path returns false rather than throwing — a malformed header
 * must be a rejection, not a 500 that looks like an outage.
 */
export function verifySlackSignature(args: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  secret: string
  now?: number
}): boolean {
  const { rawBody, timestamp, signature, secret } = args
  if (!timestamp || !signature || !secret) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = args.now ?? Date.now()
  if (Math.abs(now / 1000 - ts) > REPLAY_WINDOW_SECONDS) return false

  const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  // timingSafeEqual throws on a length mismatch, so check length first — and
  // a length mismatch is already a failed comparison.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Parse `/portfolio-request <title> | <problem> | <sponsor>`.
 *
 * Pipes rather than flags: nobody typing into a Slack box remembers
 * `--sponsor=`, and a request that fails to parse is a request that never gets
 * filed. Missing parts come through empty for triage to chase.
 */
export function parseSlackIntake(text: string): {
  title: string
  problem: string
  sponsor: string | null
} {
  const parts = text.split('|').map((s) => s.trim())
  return {
    title: parts[0] ?? '',
    problem: parts[1] ?? '',
    sponsor: parts[2] || null,
  }
}
