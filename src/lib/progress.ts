/**
 * `workstreams.progress`, read the same way by everybody.
 *
 * WHAT WAS WRONG
 *
 * One column, two scales, depending on who wrote the row last.
 *
 *   - The Linear sync stores what Linear reports: a fraction, 0 to 1. That is
 *     completed issues over scope, and it is the only measurement of work done
 *     that this app has from anywhere.
 *   - A person editing the field on a list row stored what they typed: 0 to
 *     100.
 *
 * And the readers disagreed in the same way. The timeline multiplied by 100
 * and was right for synced rows; the Workstreams page, the Projects page and
 * the workstream tile on a project detail page rounded the raw value and
 * printed **0%** for every synced row, with a progress bar 0.62% wide. Which
 * is why nobody noticed the app already had a real completion figure: it read
 * as zero everywhere you would have gone looking for it.
 *
 * WHAT THIS DOES
 *
 * Every read goes through here, and the stored scale is the fraction — so a
 * value at or below 1 is taken as a fraction and anything above it as a
 * percentage somebody typed. That rule is not a guess: it is the same one the
 * sync has always applied on the way in (see sources/linear-map.ts), and it
 * gets both kinds of existing row right without a migration that would have to
 * decide what a stored `1` meant.
 *
 * The one genuinely ambiguous value is exactly 1 — one percent typed by hand,
 * or finished, from Linear. It reads as finished, because that is what it
 * means in the scale everything is now written in.
 */

/** 0–1, whichever scale the row was written in. */
export function progressFraction(raw: number | null | undefined): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(1, n > 1 ? n / 100 : n)
}

/** 0–100, rounded, for display. */
export function progressPercent(raw: number | null | undefined): number {
  return Math.round(progressFraction(raw) * 100)
}
