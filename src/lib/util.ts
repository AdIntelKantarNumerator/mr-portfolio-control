export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function fmtDate(d: Date | string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return opts.year ? MONTH_DAY_YEAR.format(date) : MONTH_DAY.format(date)
}

export function fmtRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): string {
  if (!start && !end) return '—'
  if (!start) return `→ ${fmtDate(end)}`
  if (!end) return `${fmtDate(start)} →`
  return `${fmtDate(start)} → ${fmtDate(end)}`
}

export function daysUntil(d: Date | string | null | undefined, now = new Date()): number | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return Math.round((date.getTime() - now.getTime()) / 86_400_000)
}

export function relativeDays(d: Date | string | null | undefined, now = new Date()): string {
  const n = daysUntil(d, now)
  if (n === null) return ''
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n < 0) return `${Math.abs(n)}d ago`
  if (n < 45) return `in ${n}d`
  return `in ${Math.round(n / 30)}mo`
}

/** Stable, readable reference like REQ-014 / D7. */
export function nextRef(prefix: string, existing: string[]): string {
  const nums = existing
    .map((r) => Number(r.replace(/^\D+/, '')))
    .filter((n) => Number.isFinite(n))
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `${prefix}${String(next).padStart(prefix.endsWith('-') ? 3 : 1, '0')}`
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const item of items) {
    const k = key(item)
    ;(out[k] ??= []).push(item)
  }
  return out
}

/**
 * Milestones past their target date and not marked complete.
 *
 * Lives here rather than inline in a page because reading the clock during
 * render is impure — the same component would produce different output on two
 * passes, which is exactly what the React compiler refuses to assume away.
 */
export function overdueMilestones<T extends { id: string; targetDate: Date | null; status: string }>(
  milestones: T[],
  now: number = Date.now(),
): Set<string> {
  return new Set(
    milestones
      .filter((m) => m.targetDate && m.targetDate.getTime() < now && m.status !== 'completed')
      .map((m) => m.id),
  )
}
